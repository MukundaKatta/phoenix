import { css } from "@emotion/react";
import { useMemo } from "react";
import { graphql, useFragment } from "react-relay";

import {
  Disclosure,
  DisclosureGroup,
  DisclosurePanel,
  DisclosureTrigger,
  Flex,
  SectionHeading,
  Text,
  View,
} from "@phoenix/components";
import { JSONBlock } from "@phoenix/components/code";
import type { PromptTools__main$key } from "@phoenix/pages/prompt/__generated__/PromptTools__main.graphql";
import { safelyStringifyJSON } from "@phoenix/utils/jsonUtils";

type ToolDefinitionItem = {
  name: string;
  description?: string;
  definition: string;
};

export function PromptTools({
  promptVersion,
}: {
  promptVersion: PromptTools__main$key;
}) {
  const { tools: toolsData } = useFragment<PromptTools__main$key>(
    graphql`
      fragment PromptTools__main on PromptVersion {
        tools {
          functionTools {
            function {
              name
              description
              parameters
              strict
            }
          }
          vendorTools {
            vendorSdk
            definitions
          }
        }
      }
    `,
    promptVersion
  );

  const items: ToolDefinitionItem[] = useMemo(() => {
    if (!toolsData) return [];
    const functionItems = (toolsData.functionTools ?? []).map((tool, i) => {
      const fn = tool.function;
      const definition = { type: "function", function: fn };
      return {
        name: fn.name || `Tool ${i + 1}`,
        description: fn.description || undefined,
        definition: safelyStringifyJSON(definition, null, 2).json || "{}",
      };
    });
    if (toolsData.vendorTools) {
      const vendorItems = toolsData.vendorTools.definitions.map(
        (def: unknown, i: number) => {
          const obj = def as Record<string, unknown>;
          const name =
            (typeof obj.name === "string" && obj.name) ||
            (typeof obj.type === "string" && obj.type) ||
            // Google tools are bags of capabilities keyed by name
            // e.g. { google_search: {}, code_execution: {} }
            Object.keys(obj).join(", ") ||
            `Vendor tool ${i + 1}`;
          return {
            name,
            description: `${toolsData.vendorTools?.vendorSdk ?? "vendor"} tool`,
            definition: safelyStringifyJSON(def, null, 2).json || "{}",
          };
        }
      );
      return [...functionItems, ...vendorItems];
    }
    return functionItems;
  }, [toolsData]);

  if (items.length === 0) {
    return (
      <Disclosure id="tools">
        <DisclosureTrigger>Tools</DisclosureTrigger>
        <DisclosurePanel>
          <View padding="size-200">
            <Flex justifyContent="center" alignItems="center">
              <Text color="text-300">No tools specified for this prompt</Text>
            </Flex>
          </View>
        </DisclosurePanel>
      </Disclosure>
    );
  }

  return (
    <Flex direction="column">
      <SectionHeading bordered={false}>Tools</SectionHeading>
      <DisclosureGroup
        css={css`
          & {
            > .disclosure:last-child {
              &[data-expanded="true"] {
                border-bottom: 1px solid var(--global-border-color-default);
              }
            }
          }
        `}
      >
        {items.map((item, i) => (
          <Disclosure key={`${item.name}-${i}`} id={`tool-${i}`}>
            <DisclosureTrigger
              arrowPosition="start"
              justifyContent="space-between"
            >
              <Text>{item.name}</Text>
              <Text>{item.description}</Text>
            </DisclosureTrigger>
            <DisclosurePanel>
              <JSONBlock value={item.definition} />
            </DisclosurePanel>
          </Disclosure>
        ))}
      </DisclosureGroup>
    </Flex>
  );
}
