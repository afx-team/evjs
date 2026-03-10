import { describe, expect, it } from "vitest";
import { generateServerEntry } from "../src/entry.js";

describe("generateServerEntry", () => {
  it("generates an isomorphic entry with user functions, createApp, and a default fetch handler", () => {
    const result = generateServerEntry(undefined, [
      "/project/src/api/users.server.ts",
    ]);

    expect(result).toContain("import * as _fns_0");
    expect(result).toContain("export { _fns_0 }");
    expect(result).toContain(
      'import { createApp } from "@evjs/runtime/server"',
    );
    expect(result).toContain("export { createApp }");
    expect(result).toContain("export default createFetchHandler(app)");
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
    // Still creates app and exports handler
    expect(result).toContain("export { createApp }");
    expect(result).toContain("export default createFetchHandler(app)");
  });

  it("passes endpoint to createApp when provided", () => {
    const result = generateServerEntry(
      undefined,
      ["/project/src/api/hello.server.ts"],
      "/rpc/v1",
    );

    expect(result).toContain('endpoint: "/rpc/v1"');
  });

  it("uses default createApp call when no endpoint is provided", () => {
    const result = generateServerEntry(undefined, [
      "/project/src/api/hello.server.ts",
    ]);

    expect(result).toContain("const app = createApp()");
  });

  it("includes middleware imports before server modules", () => {
    const result = generateServerEntry(
      {
        middleware: ['import "dotenv/config";'],
      },
      ["/project/src/api/hello.server.ts"],
    );

    expect(result).toContain('import "dotenv/config"');
    // Middleware should come before module imports
    const dotenvIndex = result.indexOf('import "dotenv/config"');
    const fnsIndex = result.indexOf("import * as _fns_0");
    expect(dotenvIndex).toBeLessThan(fnsIndex);
  });
});
