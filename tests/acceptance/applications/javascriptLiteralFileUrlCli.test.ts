import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves literal file URL conversion in CLI and MCP path evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-literal-file-url-");
    const cases = [
      {
        expression: 'fileURLToPath("file:///app/preload%20file.js")',
        path: "/app/preload file.js",
      },
      {
        expression: 'fileURLToPath("file:///app/preload.js")',
        path: "/app/preload.js",
      },
      {
        expression: 'fileURLToPath(new URL("./relative.js", import.meta.url))',
        path: "./relative.js",
      },
      { expression: "fileURLToPath(runtimePath)", path: null },
      {
        expression: 'fileURLToPath("https://example.test/preload.js")',
        path: null,
      },
    ];
    const lines = cases.map(
      ({ expression }) =>
        `new BrowserWindow({ webPreferences: { preload: ${expression} } });`,
    );
    const source = `${lines.join("\n")}\nimport { BrowserWindow } from "electron";\nimport { fileURLToPath } from "node:url";\nthrow new Error("fixture must remain inert");\n`;
    const sourcePath = join(root, "main.mjs");
    await writeFile(sourcePath, source);
    await writeFile(join(root, "relative.js"), "export const value = 42;\n");

    const response = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, `${response.stderr}\n${response.stdout}`).toBe(0);
    const envelope = z.object({
      normalized_result: javascriptApplicationAnalysisResultSchema,
    });
    const cliGraph = envelope.parse(response.json).normalized_result.graph;
    const { call } = await connectLocalToolsMcp();
    const mcp = await call("analyze_javascript_application", {
      input_path: root,
    });
    expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
    const graph = envelope.parse(mcp.structuredContent).normalized_result.graph;
    expect(graph).toEqual(cliGraph);
    const windows = graph.nodes.filter(({ kind }) => kind === "browser-window");
    expect(windows).toHaveLength(cases.length);
    for (const [index, scenario] of cases.entries()) {
      const window = windows.find((node) => {
        const location = node.observations[0]?.evidence.location;
        return (
          location?.available &&
          location.value.kind === "source-range" &&
          location.value.start.line === index + 1
        );
      });
      expect(window?.observations[0]).toMatchObject({
        properties: {
          preload_path: scenario.path,
          preload_resolution_context:
            scenario.path === null ? null : "filesystem-expression",
        },
        evidence: {
          location: {
            available: true,
            value: { source: "main.mjs", start: { line: index + 1 } },
          },
        },
      });
    }
    const paths = graph.nodes
      .filter(({ kind }) => kind === "electron-preload")
      .flatMap(({ observations }) =>
        observations.map(({ properties }) => properties),
      );
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          declared_path: "/app/preload file.js",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          declared_path: "/app/preload.js",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          declared_path: "./relative.js",
          resolved_path: "relative.js",
          resolution_status: "resolved",
        }),
      ]),
    );
    expect(paths).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          declared_path: "file:///app/preload%20file.js",
        }),
      ]),
    );
    expect(await readFile(sourcePath, "utf8")).toBe(source);
  },
);
