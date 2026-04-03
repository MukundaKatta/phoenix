# Vendor-Specific Tools in Phoenix Prompt Versions

**Date:** 2026-04-02

---

## 1. Problem

Phoenix prompt versions can only represent **function tools** — the classic JSON-schema-based tool that all LLM vendors support. But vendors now offer many non-function tool types (web search, code execution, computer use, MCP, file search, etc.) with vendor-specific configuration. These tools cannot be stored in, round-tripped through, or passed to LLM APIs via Phoenix's current model.

When a user traces an LLM call that uses vendor-specific tools and clicks "Open in Playground," those tools are **silently dropped**.

---

## 2. Background

### 2.1 Current function tool architecture

Phoenix stores function tools in a canonical form and converts to/from vendor-specific formats (hub-and-spoke):

```
[Store: CanonicalToolDefinition]
    → getToolDefinitionDisplay(canonical, provider)
        → [Editor: provider-specific JSON]
            → toCanonicalToolDefinition(display)
                → [Store: CanonicalToolDefinition]
```

This works because function tools are semantically identical across vendors — they all have `name`, `description`, `parameters`, and optionally `strict`. The conversion is lossless.

### 2.2 Vendor tool landscape

| Category | Description | Examples |
|----------|-------------|----------|
| **Simple toggles** | Just a type identifier | Anthropic `code_execution_20260120`, Google `code_execution: {}`, OpenAI `code_interpreter` |
| **Configured builtins** | Type + vendor-specific config | Anthropic `web_search` (max_uses, allowed_domains), OpenAI `file_search` (vector_store_ids) |
| **Connectors** | External tool sources with credentials | OpenAI `mcp` (server_url, auth), Google `mcp_servers` |

Cross-vendor concepts exist (web search, code execution, computer use) but the configuration differs so much that normalization is lossy. Web search — the best candidate — has 9 config fields across vendors, but only 3 are portable. Code execution has zero portable config fields.

### 2.3 Why normalization doesn't work for vendor tools

Function tools are the **only** truly universal type. Everything else is vendor-specific:

- **Web search:** Anthropic has `allowed_domains`, `max_uses`; OpenAI has `search_context_size`; Google has `dynamic_retrieval_config` — each unique to one vendor.
- **Code execution:** Ranges from pure toggles (Anthropic, Google) to infrastructure provisioning with IAM roles and VPC configs (AWS).
- **Connectors (MCP):** Embed secrets (bearer tokens, API keys) directly in definitions — these are runtime config, not prompt semantics.

A canonical model for any of these would capture "enable X" as a toggle but lose the config users actually need.

### 2.4 Span ingestion

Tools enter Phoenix from spans via OpenTelemetry. Instrumentation libraries capture tool definitions verbatim:

```python
# Both Anthropic and OpenAI instrumentors do the same thing:
for tool in tools:
    yield f"llm.tools.{i}.tool.json_schema", safe_json_dumps(tool)
```

The full vendor definitions (including all config fields) are already stored in span attributes. Phoenix just can't parse them — `toCanonicalToolDefinition()` rejects non-function shapes and silently drops them.

---

## 3. Design: Parallel Tracks

### 3.1 Core idea

Two parallel modes for tools, never mixed:

- **Function mode** (existing): Canonical tools with hub-and-spoke conversion, schema-validated editing, cross-vendor portability.
- **Vendor mode** (new): Raw JSON passthrough. What you type is what gets sent. No conversion, no validation, no normalization. Locked to one vendor.

This mirrors how Phoenix already handles invocation parameters — stored as a raw JSON dict, sent verbatim, no cross-vendor conversion.

### 3.2 Why not a mixed list?

Putting both types in a single `list[FunctionTool | VendorTool]` forces every consumer to branch on every tool. It also requires a classification heuristic to guess whether user-typed JSON is a function tool or vendor passthrough — inherently brittle.

The two paths share nothing except that they both end up in the `tools` array of an LLM API call. Separating them means one branch at the top, then linear paths through every layer.

### 3.3 DB model

```python
# Existing (unchanged)
class PromptToolFunctionDefinition(DBBaseModel):
    name: str
    description: str = UNDEFINED
    parameters: dict[str, Any] = UNDEFINED
    strict: bool = UNDEFINED

class PromptToolFunction(DBBaseModel):
    type: Literal["function"]
    function: PromptToolFunctionDefinition

# New
class PromptVendorTools(DBBaseModel):
    type: Literal["vendor"]
    vendor_sdk: ToolVendorSDK
    definitions: list[dict[str, Any]]

# Updated (was: tools: list[PromptToolFunction])
class PromptTools(DBBaseModel):
    type: Literal["tools"]
    tools: list[PromptToolFunction] | PromptVendorTools
    tool_choice: PromptToolChoice = UNDEFINED
    disable_parallel_tool_calls: bool = UNDEFINED
```

**How Pydantic resolves it:** `"tools": [...]` (JSON array) → `list[PromptToolFunction]`. `"tools": {"type": "vendor", ...}` (JSON object) → `PromptVendorTools`. Arrays and objects are syntactically unambiguous.

**Backward compatible:** Every existing row has `"tools": [...]`. No migration needed.

**`tool_choice` and `disable_parallel_tool_calls`** sit on the container and apply to both modes. The playground client already converts canonical tool choice to each vendor's native format.

### 3.4 What the JSON looks like in the database

**Function mode** (existing rows — unchanged):

```json
{
  "type": "tools",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current temperature.",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string"
            }
          },
          "required": ["city"]
        },
        "strict": true
      }
    }
  ],
  "tool_choice": {
    "type": "zero_or_more"
  }
}
```

**Vendor mode** (new):

```json
{
  "type": "tools",
  "tools": {
    "type": "vendor",
    "vendor_sdk": "openai",
    "definitions": [
      {
        "type": "function",
        "name": "get_weather",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string"
            }
          },
          "required": ["city"]
        },
        "strict": true
      },
      {
        "type": "web_search",
        "search_context_size": "medium"
      }
    ]
  },
  "tool_choice": {
    "type": "zero_or_more"
  }
}
```

### 3.5 Frontend model

```typescript
type VendorTools = {
  vendorSdk: ToolVendorSDK;              // "OPENAI" | "ANTHROPIC" | "GOOGLE_GENAI" | "AWS_BEDROCK"
  definitions: Record<string, unknown>[];
};

type PlaygroundInstance = {
  // ...existing fields...
  tools: Tool[];                         // function mode (canonical)
  vendorTools: VendorTools | null;       // vendor mode (raw JSON)
};
```

The mode is implicit: `vendorTools != null` → vendor mode, otherwise function mode. No explicit `toolMode` field — less state to keep in sync.

### 3.6 Editor UX

**Function mode** (unchanged): Per-tool collapsible cards, each with a schema-validated JSON editor showing provider-specific format. Existing hub-and-spoke conversion. A "+ Tool" button adds more function tools.

**Vendor mode**: A single JSON array editor. The user pastes exactly what their SDK expects for the `tools` parameter. No schema validation, no conversion. The card has copy and delete buttons matching the function tool card layout.

**Track selection (no tools yet):** The "+ Tool" button opens a dropdown with two options:
- "Function tool" — adds a canonical function tool (existing behavior)
- "Vendor tools (JSON)" — creates a vendor tools editor pre-populated with the provider's web search tool as a starting template

**Switching between modes (tools exist):** A "Switch to vendor JSON" / "Switch to function tools" button appears at the bottom of the tools section.
- Function → Vendor: always works. Converts each function tool to vendor format via `getToolDefinitionDisplay()`.
- Vendor → Function: conditional. Tries `toCanonicalToolDefinition()` on each item. All succeed → converts. Any fail → shows a notification and stays in vendor mode.
- Switching to vendor resets tool choice to auto (`ZERO_OR_MORE`), since specific-function choices don't apply in vendor mode.

**Mutual exclusivity:** Only one track's UI renders at a time. The footer's "+ Tool" button only appears in function mode.

---

## 4. What users paste in vendor mode

The mental model is: **"paste your `tools` array here."**

### OpenAI

```python
# User's SDK call:
client.responses.create(
    model="gpt-4o",
    tools=[                          # ← user copies this list
        {
            "type": "function",
            "name": "get_weather",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": { "type": "string" }
                }
            },
            "strict": True
        },
        {
            "type": "web_search",
            "search_context_size": "medium"
        },
        {
            "type": "code_interpreter"
        }
    ],
    tool_choice="auto",              # ← separate param, not part of the list
)
```

They paste:

```json
[
  {
    "type": "function",
    "name": "get_weather",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string"
        }
      }
    },
    "strict": true
  },
  {
    "type": "web_search",
    "search_context_size": "medium"
  },
  {
    "type": "code_interpreter"
  }
]
```

Function tools and built-in tools coexist naturally — they're all elements with a `type` field.

### Anthropic

```python
client.messages.create(
    model="claude-sonnet-4-20250514",
    tools=[                          # ← user copies this list
        {
            "name": "get_weather",
            "input_schema": {
                "type": "object",
                "properties": {
                    "city": { "type": "string" }
                }
            }
        },
        {
            "type": "web_search_20260209",
            "name": "web_search",
            "max_uses": 5
        },
        {
            "type": "code_execution_20260120"
        }
    ],
    tool_choice={"type": "auto"},    # ← separate param
)
```

They paste:

```json
[
  {
    "name": "get_weather",
    "input_schema": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string"
        }
      }
    }
  },
  {
    "type": "web_search_20260209",
    "name": "web_search",
    "max_uses": 5
  },
  {
    "type": "code_execution_20260120"
  }
]
```

Note: Anthropic function tools have **no `type` field**, while built-in tools have versioned `type` strings. This asymmetry is invisible to the user — both are just array elements.

### Google

Google is structurally different. Each element in the `tools` list is a **bag of capabilities**, not a single tool:

```python
client.models.generate_content(
    model="gemini-2.0-flash",
    contents=...,
    config=GenerateContentConfig(
        tools=[                      # ← user copies this list
            Tool(
                function_declarations=[
                    FunctionDeclaration(
                        name="get_weather",
                        parameters_json_schema={...}
                    )
                ],
                google_search=GoogleSearch(),
                code_execution=ToolCodeExecution(),
            )
        ],
        tool_config=ToolConfig(...),  # ← separate param (tool choice)
    ),
)
```

They paste — typically a **single-element array** with multiple keys:

```json
[
  {
    "function_declarations": [
      {
        "name": "get_weather",
        "parameters_json_schema": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string"
            }
          }
        }
      }
    ],
    "google_search": {},
    "code_execution": {}
  }
]
```

A user who wants just web search pastes:

```json
[
  {
    "google_search": {}
  }
]
```

### AWS Bedrock

AWS bundles tools inside `toolConfig`, not as a top-level param:

```python
client.converse(
    modelId="anthropic.claude-sonnet-4-20250514-v1:0",
    messages=...,
    toolConfig={                     # tools and toolChoice are siblings here
        "tools": [                   # ← user copies this inner list
            {
                "toolSpec": {
                    "name": "get_weather",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "city": { "type": "string" }
                            }
                        }
                    }
                }
            },
            {
                "systemTool": {
                    "name": "web_search"
                }
            }
        ],
        "toolChoice": {"auto": {}}   # ← sits next to tools, not top-level
    }
)
```

They paste the `tools` array from inside `toolConfig`:

```json
[
  {
    "toolSpec": {
      "name": "get_weather",
      "inputSchema": {
        "json": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string"
            }
          }
        }
      }
    }
  },
  {
    "systemTool": {
      "name": "web_search"
    }
  }
]
```

---

## 5. The universal seam: tools list vs tool choice

Every vendor separates tool definitions from tool choice:

| Vendor | Tools | Tool choice | Relationship |
|--------|-------|-------------|--------------|
| OpenAI | `tools=[...]` | `tool_choice="auto"` | Separate top-level params |
| Anthropic | `tools=[...]` | `tool_choice={"type": "auto"}` | Separate top-level params |
| Google | `tools=[Tool(...)]` | `tool_config=ToolConfig(...)` | Separate top-level params |
| AWS | `toolConfig.tools=[...]` | `toolConfig.toolChoice={...}` | Sibling keys inside `toolConfig` |

The **tools list** (`list[dict]`) is the universal storage unit. Tool choice is always separate. This is where we cut: the passthrough editor holds the tools list; tool choice uses the existing canonical dropdown (the playground client already converts to vendor format).

Tool choice formats vary but the canonical values cover all vendors:

```python
# OpenAI — string or object
"auto" | "required" | "none"
{"type": "function", "function": {"name": "get_weather"}}

# Anthropic — always an object
{"type": "auto"} | {"type": "any"} | {"type": "none"}
{"type": "tool", "name": "get_weather"}

# Google — nested config (only governs function declarations)
{"function_calling_config": {"mode": "AUTO", "allowed_function_names": [...]}}

# AWS — object with one key (no "none" — just omit toolConfig)
{"auto": {}} | {"any": {}}
{"tool": {"name": "get_weather"}}
```

---

## 6. Switching between modes

Switching is done via buttons at the bottom of the tools section, not a header toggle. The conversion is destructive (one track replaces the other), but this matches the DB model where `PromptTools.tools` is a union — you can't have both.

### Function → Vendor (always works)

Convert each function tool to the current provider's native format using `getToolDefinitionDisplay()` and produce a raw JSON array. Clear function tools and set vendor tools. Reset tool choice to auto.

### Vendor → Function (conditional)

Try `toCanonicalToolDefinition()` on every item in the vendor JSON array:

- **All succeed** → convert to function mode. Clear vendor tools.
- **Any fails** → show a notification: "Cannot switch to function tools. The vendor tools list contains non-function tools that cannot be converted. Remove them first." Stay in vendor mode.

---

## 7. Loading spans into the playground

When a user clicks "Open in Playground" on a span, the playground loads the span's tool definitions. Tools are classified per-tool and split into two fields:

```
llm.tools[i].tool.json_schema (string per tool)
  → JSON.parse each (raw JSON preserved, no provider-schema normalization)
    → toCanonicalToolDefinition() on each tool
      → succeeds  → added to tools: FunctionTool[]
      → fails     → added to passthroughDefinitions[]

  passthroughDefinitions.length > 0
    → vendorTools = { vendorSdk, definitions: passthroughDefinitions }
  otherwise
    → vendorTools = null
```

`vendor_sdk` comes from the span's `llm.provider` attribute mapped through `providerToVendorSDK()`.

**OpenAI Responses API auto-detection:** When vendor tools are detected with `vendorSdk === "OPENAI"`, the playground automatically switches the API type to Responses (`openaiApiType: "RESPONSES"`), since vendor-specific tools like `web_search` are only available in the Responses API. This happens both when loading spans and when loading prompts.

### 7.1 How canonical classification works

The critical question is: **how does `toCanonicalToolDefinition()` decide "this is a function tool"?**

The answer is **strict schema matching**. The function tries each vendor's function-tool schema in order. If a schema matches, the tool is canonical. If none match, it's vendor passthrough.

```
toCanonicalToolDefinition(raw)
  ├─ OpenAI CC:    z.looseObject({ type: "function", function: { name, ... } })
  ├─ OpenAI Resp:  z.looseObject({ type: "function", name, parameters, ... })
  ├─ Anthropic:    z.object({ name, input_schema }).strict()
  ├─ AWS:          z.object({ toolSpec: { name, inputSchema } }).strict()
  └─ Gemini:       z.object({ name, parameters? }).strict()
       │
       ├─ First match wins → extract name/description/parameters → CanonicalToolDefinition
       └─ No match         → return null (caller treats as vendor passthrough)
```

**Why `.strict()` matters.** Without it, zod's `z.object()` silently strips unknown keys. An Anthropic `web_search` tool like `{ type: "web_search_20260209", name: "web_search", max_uses: 5 }` would match the Anthropic function schema — zod strips `type` and `max_uses`, returns `{ name: "web_search" }`, and the tool is misclassified as a function tool named "web_search" with no parameters.

With `.strict()`, that same input **fails** the Anthropic parse because `type` and `max_uses` are unrecognized keys. It falls through all schemas, returns null, and correctly becomes a vendor passthrough.

The OpenAI schemas use `z.looseObject()` (extra keys preserved) because they require `type: "function"` — only actual function tools can match.

**This is the only classification logic.** There is no key enumeration, no heuristic, no `isVendorSpecificTool()` check. The canonical schemas define what a function tool IS. Everything else is passthrough by definition.

### 7.2 Data flow: span → playground

```
  Span attributes
       │
       ▼
  toolJSONSchemaSchema        Parse JSON string → raw object.
       │                      No normalization — raw JSON preserved.
       ▼
  processAttributeTools       For each tool:
       │                        toCanonicalToolDefinition(raw)
       │                          → success: FunctionTool
       │                          → failure: passthroughDefinitions[]
       ▼
  PlaygroundInstance
    ├── tools: FunctionTool[]           (canonical, editable per-tool)
    └── vendorTools: VendorTools|null   (raw JSON, single array editor)
              ├── vendorSdk: "OPENAI"|"ANTHROPIC"|...
              └── definitions: Record<string, unknown>[]
```

---

## 8. What this simplifies

1. **No classification heuristic in the editor.** The user explicitly picks the mode via the dropdown/switch. No `classifyToolEdit()`.
2. **Classification when loading spans uses strict schema matching.** `toCanonicalToolDefinition()` with `.strict()` on Anthropic/AWS/Gemini schemas — no key enumeration, no vendor-specific detection logic. The canonical schemas define what a function tool IS; everything else is passthrough by definition (see 7.1).
3. **No per-tool branching in rendering.** In function mode, all tools are `FunctionTool`. In vendor mode, all tools are raw dicts.
4. **Editor is mode-dependent, not per-tool.** Function mode: schema-validated per-tool editors. Vendor mode: single raw JSON array editor.
5. **Serialization is trivial.** Function mode: existing `toolToPromptToolFunctionInput`. Vendor mode: send the raw definitions to `PromptVendorToolsInput`.
6. **Code export works for both.** Function mode: emit proper SDK code. Vendor mode: emit raw JSON definitions directly (already in vendor format).
7. **The validation gap is scoped.** In function mode, existing behavior continues. In vendor mode, there's no pretense of validation.
8. **Invocation parameter analogy.** Vendor tools work like invocation parameters: raw JSON, stored and sent verbatim.

---

## 9. What this does NOT change

- The `PromptToolFunction` model is untouched.
- The hub-and-spoke conversion for function tools is untouched.
- The existing per-tool editor for function tools is untouched.

### What DID change

- The `"+ Tool"` button now opens a dropdown when no tools exist, offering "Function tool" or "Vendor tools (JSON)".
- `toolJSONSchemaSchema` no longer normalizes span tool JSON through `llmProviderToolDefinitionSchema` — raw JSON is preserved so vendor fields aren't stripped before classification.
- Google playground client skips `function_calling_config` when only vendor tools are present (Google rejects it for built-in tools like `google_search`).
- Default vendor tool templates: when creating vendor tools, the editor is pre-populated with the provider's minimal web search tool.

---

## 10. Considerations

### 10.1 Connector tools contain secrets

MCP and similar tools embed credentials (bearer tokens, API keys) in their definitions. Phoenix has no secrets management layer. Storing connector configs means credentials end up in plaintext in the DB, UI, API responses, and immutable version history. Phoenix's posture: store as-is, same as any other span attribute or prompt content that may contain sensitive data. Users are responsible for what they paste.

### 10.2 Google's structural difference

Google is the only vendor where each `tools` array element is a bag of capabilities rather than a single tool. A typical Google `tools` list is a single-element array with multiple keys (`function_declarations`, `google_search`, `code_execution`). The passthrough editor handles this naturally — the user pastes `[{...}]` with one element.

### 10.3 Anthropic's `parallel_tool_use`

Anthropic has a top-level `parallel_tool_use: bool` separate from `tools` and `tool_choice`. Phoenix models this as `disable_parallel_tool_calls` on `PromptTools`. In vendor mode, the user can also set this via invocation parameters.

### 10.4 No cross-vendor conversion for vendor tools

`prompt.format(sdk="openai")` with Anthropic vendor tools will skip them (or warn). This is expected — non-function tools are inherently vendor-specific.

### 10.5 No validation beyond JSON structure

An invalid vendor tool blob will be stored without error and fail at LLM call time. The feedback loop (playground → API error) is fast enough.

---

## 11. Open questions

1. **Mixed mode.** Resolved: Phoenix doesn't mix modes. The UI enforces exclusivity — function tools and vendor tools can't coexist on one instance. If you need a function tool alongside web_search, use vendor mode and type the function tool in vendor format. Passthrough is a superset — no loss. Loading a span splits tools into both fields, but the UI only renders one track (vendor takes priority if populated).

2. **Raw vendor tool choice.** The canonical tool choice dropdown covers all vendors today. When in vendor mode, tool choice is reset to auto and the dropdown still works (playground clients convert canonical tool choice to vendor format). Google's `function_calling_config` is skipped when there are no function declarations. If users later need vendor-specific tool choice config the dropdown can't express, `PromptVendorTools` can gain a raw `tool_choice` field without breaking existing rows.

3. **Round-trip tests.** Vendor tools are not covered by round-trip tests yet. Function tool round-trips are tested in both unit tests (`test_prompt_mutations.py`) and integration tests (`test_prompts.py`).

---

## 12. Future: normalizing web search

All four vendors offer a web search tool. The current implementation treats them as vendor passthrough, but the DB model is designed to support normalization via the `PromptTool` discriminated union.

### 12.1 The extension point

```python
# Current (single variant, ready for extension)
PromptTool: TypeAlias = Annotated[
    Union[PromptToolFunction],
    Field(..., discriminator="type")
]

# Future (add web search as a second variant)
PromptTool: TypeAlias = Annotated[
    Union[PromptToolFunction, PromptToolWebSearch],
    Field(..., discriminator="type")
]

class PromptToolWebSearch(DBBaseModel):
    type: Literal["web_search"]
```

The normalized track grows by adding union variants. The vendor track remains as the escape hatch. Both live in `PromptTools.tools: list[PromptTool] | PromptVendorTools`.

### 12.2 What normalization would look like

The canonical form is just `{ type: "web_search" }` — a toggle, no config. Playground clients convert to the vendor's native shape:

| Vendor | Wire format |
|--------|-------------|
| OpenAI | `{ "type": "web_search" }` |
| Anthropic | `{ "type": "web_search_YYYYMMDD", "name": "web_search" }` |
| Google | `Tool(google_search=GoogleSearch())` |
| AWS Bedrock | `{ "systemTool": { "name": "nova_grounding" } }` |

The UI would be a checkbox — no JSON editor needed. A span containing both function tools and web search would land both in the same `tools` list as discriminated union variants, avoiding the current split into separate `tools` + `vendorTools` fields.

### 12.3 Why not yet

**Anthropic's versioned type strings.** Anthropic versions their tool types (e.g. `web_search_20250305`). The canonical → display conversion must emit a specific version string that has a shelf life. When Anthropic releases a new version, Phoenix needs a code update. Function tools don't have this problem — `name` + `input_schema` is structurally stable.

**Span loading detection.** Recognizing vendor web search tools during span loading requires knowing each vendor's identifier shape. This is the key enumeration problem: `web_search_20250305`, `google_search`, `nova_grounding` — each must be recognized. New versions or names would be missed until Phoenix is updated. Missed tools degrade gracefully to vendor passthrough (not data loss), but the normalization benefit is lost.

**Config fields are vendor-specific.** Anthropic has `allowed_domains`, `max_uses`; OpenAI has `search_context_size`. The canonical form drops these. Users who need config must use vendor mode. This is the same trade-off as function tools (where `strict` is OpenAI-only), but more visible because web search config is more commonly used than `strict`.

### 12.4 The minimal-intersection principle

The approach mirrors how function tools are normalized: the canonical form is the **intersection** of what all vendors support. For function tools: `name`, `description`, `parameters`. For web search: just "enabled." Vendor-specific config lives in vendor mode.

This principle extends to future tool types:
- **Code execution:** canonical form is `{ type: "code_execution" }` (a toggle). Vendor-specific infra config (AWS VPC, IAM) goes to vendor mode.
- **Computer use:** too divergent across vendors — vendor mode only for now.
- **MCP/connectors:** contain secrets — vendor mode only.

Each new normalized variant is a small, isolated change: one DB model, one playground client conversion per vendor, one UI element. The discriminated union and dual-track architecture support this without redesign.
