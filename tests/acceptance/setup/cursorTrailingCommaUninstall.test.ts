import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findNodeAtLocation, parseTree } from "jsonc-parser";
import { expect } from "vitest";

import { parseClientConfiguration } from "../../../src/application/ClientConfigurationDocument.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "Cursor uninstall removes its sole trailing-comma entry without losing user data",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-cursor-trailing-comma-");
    await mkdir(join(home, ".cursor"));
    const path = join(home, ".cursor/mcp.json");
    const original =
      '{\n// Keep theme.\n"theme":"dark","metadata":{"levels":[1,2,],},"mcpServers":{}\n}\n';
    await writeFile(path, original);
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: [...args, "--json"],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home },
      });
    const setupArgs = ["setup", "--client", "cursor", "--skill=false"];
    const preview = await run([...setupArgs, "--dry-run"]);
    expect(preview.exitCode, preview.stdout).toBe(0);
    expect(preview.json).toMatchObject({
      status: "planned",
      plannedActions: [{ kind: "configure_client", target: path }],
    });
    expect(await readFile(path, "utf8")).toBe(original);
    const setup = await run([...setupArgs, "--yes"]);
    expect(setup.exitCode, setup.stdout).toBe(0);
    expect(setup.json).toMatchObject({ status: "ready" });
    const installed = await readFile(path, "utf8");
    const tree = parseTree(installed, [], { allowTrailingComma: true });
    if (tree === undefined) throw new Error("Missing installed JSONC tree");
    const registration = findNodeAtLocation(tree, ["mcpServers", "rea"]);
    if (registration === undefined)
      throw new Error("Missing setup registration");
    const end = registration.offset + registration.length;
    const changed = installed.slice(0, end) + "," + installed.slice(end);
    await writeFile(path, changed);
    const doctor = await run(["doctor", "--client", "cursor"]);
    expect(doctor.exitCode, doctor.stdout).toBe(0);
    expect(doctor.json).toMatchObject({
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({ client: "cursor", state: "aligned" }),
        ]),
      },
    });
    const backup = await readFile(`${path}.rea.backup`, "utf8");
    const removed = await run(["uninstall"]);
    expect(removed.exitCode, removed.stdout).toBe(0);
    expect(removed.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "cursor", status: "removed" }),
      ]),
    });
    const after = await readFile(path, "utf8");
    expect(parseClientConfiguration(after, "json").document).toEqual(
      parseClientConfiguration(original, "json").document,
    );
    expect(after).toContain("// Keep theme.");
    expect(await readFile(`${path}.rea.backup`, "utf8")).toBe(backup);
  },
);
