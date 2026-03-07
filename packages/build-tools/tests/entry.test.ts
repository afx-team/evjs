import { describe, expect, it } from "vitest";
import { generateServerEntry } from "../src/entry.js";

describe("generateServerEntry", () => {
  it("generates entry with user functions and createApp", () => {
    const result = generateServerEntry(undefined, [
      "/project/src/api/users.server.ts",
    ]);

    expect(result).toContain("import * as _fns_0");
    expect(result).toContain("export { _fns_0 }");
    expect(result).toContain(
      'export { createApp } from "@evjs/runtime/server"',
    );
  });

  it("imports and re-exports all server modules", () => {
    const result = generateServerEntry(undefined, [
      "/project/src/api/users.server.ts",
      "/project/src/api/posts.server.ts",
      "/project/src/api/auth.server.ts",
    ]);

    expect(result).toContain("import * as _fns_0");
    expect(result).toContain("import * as _fns_1");
    expect(result).toContain("import * as _fns_2");
    expect(result).toContain("export { _fns_0, _fns_1, _fns_2 }");
  });

  it("includes middleware imports when configured", () => {
    const result = generateServerEntry(
      {
        middleware: [
          'import "./instrument.js";',
          'import { config } from "dotenv";',
        ],
      },
      ["/project/src/api/users.server.ts"],
    );

    expect(result).toContain('import "./instrument.js"');
    expect(result).toContain('import { config } from "dotenv"');
  });

  it("handles empty server modules array", () => {
    const result = generateServerEntry(undefined, []);

    expect(result).not.toContain("import * as _fns");
    // Still exports createApp for the adapter layer
    expect(result).toContain("export { createApp }");
  });
});
