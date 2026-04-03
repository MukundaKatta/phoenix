import {
  Button,
  Flex,
  Icon,
  Icons,
  Menu,
  MenuContainer,
  MenuItem,
  MenuTrigger,
} from "@phoenix/components";
import { usePlaygroundContext } from "@phoenix/contexts/PlaygroundContext";
import type {
  CanonicalResponseFormat,
  PlaygroundNormalizedInstance,
} from "@phoenix/store";
import { generateMessageId } from "@phoenix/store";
import type { ToolVendorSDK } from "@phoenix/store/playground";

import { createTool, providerToVendorSDK } from "./playgroundUtils";

/**
 * Minimal web search tool definition per vendor SDK.
 * Used as the default template when a user adds vendor tools.
 */
function defaultVendorSearchTool(sdk: ToolVendorSDK): Record<string, unknown> {
  switch (sdk) {
    case "ANTHROPIC":
      return { type: "web_search_20250305", name: "web_search" };
    case "GOOGLE_GENAI":
      return { google_search: {} };
    case "AWS_BEDROCK":
      return { systemTool: { name: "nova_grounding" } };
    case "OPENAI":
    default:
      return { type: "web_search" };
  }
}

const DEFAULT_RESPONSE_FORMAT: CanonicalResponseFormat = {
  type: "json_schema",
  jsonSchema: {
    name: "response",
    schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
};

type PlaygroundChatTemplateFooterProps = {
  instanceId: number;
  hasResponseFormat: boolean;
  supportsResponseFormat: boolean;
  disableNewTool?: boolean;
};

const FOOTER_MIN_HEIGHT = 32;

export function PlaygroundChatTemplateFooter({
  instanceId,
  hasResponseFormat,
  supportsResponseFormat,
  disableNewTool,
}: PlaygroundChatTemplateFooterProps) {
  const instances = usePlaygroundContext((state) => state.instances);
  const updateInstance = usePlaygroundContext((state) => state.updateInstance);
  const addMessage = usePlaygroundContext((state) => state.addMessage);
  const setResponseFormat = usePlaygroundContext(
    (state) => state.setResponseFormat
  );
  const playgroundInstance = instances.find(
    (instance) => instance.id === instanceId
  );
  if (!playgroundInstance) {
    throw new Error(`Playground instance ${instanceId} not found`);
  }
  const { template } = playgroundInstance;
  if (template.__type !== "chat") {
    throw new Error(`Invalid template type ${template.__type}`);
  }

  const supportsToolChoice = !disableNewTool;
  const hasFunctionTools = playgroundInstance.tools.length > 0;
  const hasVendorTools = playgroundInstance.vendorTools != null;
  const hasAnyTools = hasFunctionTools || hasVendorTools;

  const addFunctionTool = () => {
    const patch: Partial<PlaygroundNormalizedInstance> = {
      tools: [
        ...playgroundInstance.tools,
        createTool({
          toolNumber: playgroundInstance.tools.length + 1,
        }),
      ],
    };
    if (playgroundInstance.tools.length === 0) {
      patch.toolChoice = { type: "ZERO_OR_MORE" };
    }
    updateInstance({
      instanceId,
      patch,
      dirty: true,
    });
  };

  const addVendorTools = () => {
    const vendorSdk = providerToVendorSDK(playgroundInstance.model.provider);
    updateInstance({
      instanceId,
      patch: {
        vendorTools: {
          vendorSdk,
          definitions: [defaultVendorSearchTool(vendorSdk)],
        },
        toolChoice: { type: "ZERO_OR_MORE" },
      },
      dirty: true,
    });
  };

  return (
    <Flex
      direction="row"
      justifyContent="end"
      gap="size-100"
      minHeight={FOOTER_MIN_HEIGHT}
    >
      {supportsResponseFormat ? (
        <Button
          size="S"
          aria-label="response format"
          leadingVisual={<Icon svg={<Icons.PlusOutline />} />}
          isDisabled={hasResponseFormat}
          onPress={() => {
            setResponseFormat({
              instanceId,
              responseFormat: DEFAULT_RESPONSE_FORMAT,
            });
          }}
        >
          {playgroundInstance.model.provider === "GOOGLE" ||
          playgroundInstance.model.provider === "AWS"
            ? "Response Schema"
            : "Response Format"}
        </Button>
      ) : null}
      {supportsToolChoice ? (
        hasAnyTools ? (
          // One track is active — show simple button for that track only
          hasFunctionTools ? (
            <Button
              aria-label="add tool"
              size="S"
              leadingVisual={<Icon svg={<Icons.PlusOutline />} />}
              onPress={addFunctionTool}
            >
              Tool
            </Button>
          ) : null
        ) : (
          // No tools yet — show dropdown to pick a track
          <MenuTrigger>
            <Button
              aria-label="add tool"
              size="S"
              leadingVisual={<Icon svg={<Icons.PlusOutline />} />}
            >
              Tool
            </Button>
            <MenuContainer>
              <Menu
                onAction={(key) => {
                  if (key === "function") {
                    addFunctionTool();
                  } else if (key === "vendor") {
                    addVendorTools();
                  }
                }}
              >
                <MenuItem id="function">Function tool</MenuItem>
                <MenuItem id="vendor">Vendor tools (JSON)</MenuItem>
              </Menu>
            </MenuContainer>
          </MenuTrigger>
        )
      ) : null}
      <Button
        aria-label="add message"
        size="S"
        leadingVisual={<Icon svg={<Icons.PlusOutline />} />}
        onPress={() => {
          addMessage({
            playgroundInstanceId: instanceId,
            messages: [
              {
                id: generateMessageId(),
                role: "user",
                content: "",
              },
            ],
          });
        }}
      >
        Message
      </Button>
    </Flex>
  );
}
