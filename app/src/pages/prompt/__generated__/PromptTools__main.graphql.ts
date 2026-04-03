/**
 * @generated SignedSource<<1012338b76dfc16d6a44737db220bcfd>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type ToolVendorSDK = "ANTHROPIC" | "AWS_BEDROCK" | "GOOGLE_GENAI" | "OPENAI";
import { FragmentRefs } from "relay-runtime";
export type PromptTools__main$data = {
  readonly tools: {
    readonly functionTools: ReadonlyArray<{
      readonly function: {
        readonly description: string | null;
        readonly name: string;
        readonly parameters: any;
        readonly strict: boolean | null;
      };
    }> | null;
    readonly vendorTools: {
      readonly definitions: ReadonlyArray<any>;
      readonly vendorSdk: ToolVendorSDK;
    } | null;
  } | null;
  readonly " $fragmentType": "PromptTools__main";
};
export type PromptTools__main$key = {
  readonly " $data"?: PromptTools__main$data;
  readonly " $fragmentSpreads": FragmentRefs<"PromptTools__main">;
};

const node: ReaderFragment = {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "PromptTools__main",
  "selections": [
    {
      "alias": null,
      "args": null,
      "concreteType": "PromptTools",
      "kind": "LinkedField",
      "name": "tools",
      "plural": false,
      "selections": [
        {
          "alias": null,
          "args": null,
          "concreteType": "PromptToolFunction",
          "kind": "LinkedField",
          "name": "functionTools",
          "plural": true,
          "selections": [
            {
              "alias": null,
              "args": null,
              "concreteType": "PromptToolFunctionDefinition",
              "kind": "LinkedField",
              "name": "function",
              "plural": false,
              "selections": [
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "name",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "description",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "parameters",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "strict",
                  "storageKey": null
                }
              ],
              "storageKey": null
            }
          ],
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "concreteType": "PromptVendorTools",
          "kind": "LinkedField",
          "name": "vendorTools",
          "plural": false,
          "selections": [
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "vendorSdk",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "definitions",
              "storageKey": null
            }
          ],
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "type": "PromptVersion",
  "abstractKey": null
};

(node as any).hash = "d8de758fea477dae217c729628416eb3";

export default node;
