import { useCallback, useMemo } from "react";

import {
  Button,
  Card,
  CopyToClipboardButton,
  Counter,
  Flex,
  Icon,
  Icons,
  Text,
  View,
} from "@phoenix/components";
import { JSONEditor } from "@phoenix/components/code";
import { LazyEditorWrapper } from "@phoenix/components/code/LazyEditorWrapper";
import {
  isSupportedToolChoiceProvider,
  ToolChoiceSelector,
} from "@phoenix/components/generative";
import { useNotify } from "@phoenix/contexts";
import { usePlaygroundContext } from "@phoenix/contexts/PlaygroundContext";
import type { VendorTools } from "@phoenix/store/playground";
import { safelyParseJSON } from "@phoenix/utils/jsonUtils";

import { PlaygroundTool } from "./PlaygroundTool";
import {
  getToolDefinitionDisplay,
  getToolName,
  providerToVendorSDK,
  toCanonicalToolDefinition,
} from "./playgroundUtils";
import type { PlaygroundInstanceProps } from "./types";

interface PlaygroundToolsProps extends PlaygroundInstanceProps {}

export function PlaygroundTools(props: PlaygroundToolsProps) {
  const instanceId = props.playgroundInstanceId;
  const instance = usePlaygroundContext((state) =>
    state.instances.find(
      (instance) => instance.id === props.playgroundInstanceId
    )
  );
  const updateInstance = usePlaygroundContext((state) => state.updateInstance);
  const notify = useNotify();
  if (instance == null) {
    throw new Error(`Playground instance ${instanceId} not found`);
  }
  const { tools, vendorTools } = instance;

  const toolNames = useMemo(
    () =>
      (tools ?? [])
        .map((tool) => getToolName(tool))
        .filter((name): name is NonNullable<typeof name> => name != null),
    [tools]
  );

  const toolCount =
    (tools?.length ?? 0) + (vendorTools?.definitions.length ?? 0);

  const provider = instance.model.provider;

  if (!isSupportedToolChoiceProvider(provider)) {
    return null;
  }

  const switchToVendor = () => {
    // Convert function tools to vendor format
    const definitions = tools.map(
      (t) =>
        getToolDefinitionDisplay(t.definition, provider) as Record<
          string,
          unknown
        >
    );
    updateInstance({
      instanceId,
      patch: {
        vendorTools: {
          vendorSdk: providerToVendorSDK(provider),
          definitions,
        },
        tools: [],
        toolChoice: { type: "ZERO_OR_MORE" },
      },
      dirty: true,
    });
  };

  const switchToFunction = () => {
    if (!vendorTools) return;
    // Try to convert each vendor definition back to canonical
    const canonical = vendorTools.definitions.map((d) =>
      toCanonicalToolDefinition(d)
    );
    if (canonical.some((c) => c == null)) {
      notify({
        title: "Cannot switch to function tools",
        message:
          "The vendor tools list contains non-function tools that cannot be converted. Remove them first.",
      });
      return;
    }
    updateInstance({
      instanceId,
      patch: {
        tools: canonical.map((c, i) => ({
          id: i,
          editorType: "json" as const,
          definition: c!,
        })),
        vendorTools: null,
      },
      dirty: true,
    });
  };

  return (
    <Card
      title={
        <Flex direction="row" gap="size-100" alignItems="center">
          Tools
          <Counter>{toolCount}</Counter>
        </Flex>
      }
      collapsible
    >
      <View padding="size-200">
        <Flex direction="column" gap="size-200">
          <ToolChoiceSelector
            provider={provider}
            choice={instance.toolChoice}
            onChange={(choice) => {
              updateInstance({
                instanceId,
                patch: {
                  toolChoice: choice,
                },
                dirty: true,
              });
            }}
            toolNames={toolNames}
          />
          {/* Vendor tools track */}
          {vendorTools != null && (
            <>
              <VendorToolsEditor
                instanceId={instanceId}
                vendorTools={vendorTools}
                onDelete={() => {
                  updateInstance({
                    instanceId,
                    patch: {
                      vendorTools: null,
                      toolChoice: undefined,
                    },
                    dirty: true,
                  });
                }}
              />
              <Flex justifyContent="end">
                <Button size="S" onPress={switchToFunction}>
                  Switch to function tools
                </Button>
              </Flex>
            </>
          )}
          {/* Function tools track */}
          {vendorTools == null && (
            <>
              <Flex direction={"column"} gap="size-200">
                {(tools ?? []).map((tool) => {
                  return (
                    <PlaygroundTool
                      key={tool.id}
                      playgroundInstanceId={instanceId}
                      toolId={tool.id}
                    />
                  );
                })}
              </Flex>
              {tools.length > 0 && (
                <Flex justifyContent="end">
                  <Button size="S" onPress={switchToVendor}>
                    Switch to vendor JSON
                  </Button>
                </Flex>
              )}
            </>
          )}
        </Flex>
      </View>
    </Card>
  );
}

function VendorToolsEditor({
  instanceId,
  vendorTools,
  onDelete,
}: {
  instanceId: number;
  vendorTools: VendorTools;
  onDelete: () => void;
}) {
  const updateInstance = usePlaygroundContext((state) => state.updateInstance);
  const value = useMemo(
    () => JSON.stringify(vendorTools.definitions, null, 2),
    [vendorTools.definitions]
  );
  const onChange = useCallback(
    (newValue: string) => {
      const { json } = safelyParseJSON(newValue);
      if (!Array.isArray(json)) return;
      updateInstance({
        instanceId,
        patch: {
          vendorTools: {
            vendorSdk: vendorTools.vendorSdk,
            definitions: json,
          },
        },
        dirty: true,
      });
    },
    [instanceId, updateInstance, vendorTools.vendorSdk]
  );
  return (
    <Card
      title={`Vendor tools (${vendorTools.vendorSdk})`}
      extra={
        <Flex direction="row" gap="size-100">
          <CopyToClipboardButton text={value} />
          <Button
            aria-label="delete vendor tools"
            size="S"
            leadingVisual={<Icon svg={<Icons.TrashOutline />} />}
            onPress={onDelete}
          />
        </Flex>
      }
      collapsible
    >
      <View padding="size-200">
        <Text size="XS" color="text-300">
          Paste your tools array in vendor-native JSON format.
        </Text>
      </View>
      <LazyEditorWrapper preInitializationMinHeight={100}>
        <JSONEditor value={value} onChange={onChange} />
      </LazyEditorWrapper>
    </Card>
  );
}
