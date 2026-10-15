import { describe, expect, it } from "vitest";

import {
  parseClientConfiguration,
  serializeClientConfiguration,
  withClientServers,
} from "./ClientConfigurationDocument.js";

describe("parseClientConfiguration shape diagnostics", () => {
  it.each([
    ["null", "null"],
    ["array", "[]"],
    ["string", '"x"'],
  ] as const)("names a non-object JSON root (%s)", (_label, text) => {
    expect(() => parseClientConfiguration(text, "json")).toThrow(
      new TypeError("The configuration root must be an object"),
    );
  });

  it.each([
    ["null", "null"],
    ["array", "[]"],
    ["string", '"x"'],
  ] as const)(
    'names a non-object "mcpServers" value (%s)',
    (_label, servers) => {
      expect(() =>
        parseClientConfiguration(`{"mcpServers":${servers},"keep":1}`, "json"),
      ).toThrow(new TypeError('"mcpServers" must be an object'));
    },
  );

  it("still rejects unparsable JSON with SyntaxError", () => {
    expect(() => parseClientConfiguration("not-json", "json")).toThrow(
      SyntaxError,
    );
  });
});

describe("JSONC property removal", () => {
  it.each([
    '"rea": {"command":"rea"},',
    '"rea": {"command":"rea"} /* keep after value */, // keep after comma',
    '"rea": {"command":"rea"}',
    '"other":{"command":"other"}, "rea":{"command":"rea"},',
    '"rea":{"command":"rea"}, "other":{"command":"other"},',
  ])(
    "removes a registration while retaining unrelated JSONC: %s",
    (members) => {
      const text = `{
      // Keep theme.
      "theme":"dark", "metadata":{"levels":[1,2,],},
      "mcpServers":{ // keep server comment
        ${members}
      }
    }`;
      const parsed = parseClientConfiguration(text, "json");
      const servers = { ...parsed.servers };
      delete servers.rea;
      const expected = withClientServers(parsed, servers);
      const edited = serializeClientConfiguration(expected, "json", text, [
        ["mcpServers", "rea"],
      ]);
      expect(parseClientConfiguration(edited, "json").document).toEqual(
        expected,
      );
      expect(edited).toContain("// Keep theme.");
      expect(edited).toContain("// keep server comment");
      if (members.includes("keep after")) {
        expect(edited).toContain("/* keep after value */");
        expect(edited).toContain("// keep after comma");
      }
    },
  );
});
