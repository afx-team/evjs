import { describe, expect, it } from "vitest";
import { generateFaasEntry, generateServerEntry } from "../src/entry.js";

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

describe("generateFaasEntry", () => {
  it("generates a standalone entry with createApp and fetch export", () => {
    const result = generateFaasEntry(undefined, [
      "/project/src/api/hello.server.ts",
    ]);

    expect(result).toContain("import * as _fns_0");
    expect(result).toContain(
      'import { createApp } from "@evjs/runtime/server"',
    );
    expect(result).toContain("const app = createApp(");
    expect(result).toContain("fetch: app.fetch");
    expect(result).toContain("export { app }");
  });

  it("passes endpoint to createApp when provided", () => {
    const result = generateFaasEntry(
      undefined,
      ["/project/src/api/hello.server.ts"],
      "/rpc/v1",
    );

    expect(result).toContain('endpoint: "/rpc/v1"');
  });

  it("uses default createApp call when no endpoint is provided", () => {
    const result = generateFaasEntry(undefined, [
      "/project/src/api/hello.server.ts",
    ]);

    expect(result).toContain("const app = createApp()");
  });

  it("imports all server modules", () => {
    const result = generateFaasEntry(undefined, [
      "/project/src/api/hello.server.ts",
      "/project/src/api/users.server.ts",
      "/project/src/api/orders.server.ts",
    ]);

    expect(result).toContain("import * as _fns_0");
    expect(result).toContain("import * as _fns_1");
    expect(result).toContain("import * as _fns_2");
  });

  it("includes middleware imports before server modules", () => {
    const result = generateFaasEntry(
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

  it("handles empty server modules array", () => {
    const result = generateFaasEntry(undefined, []);

    expect(result).not.toContain("import * as _fns");
    // Should still create app and export handler
    expect(result).toContain("const app = createApp(");
    expect(result).toContain("fetch: app.fetch");
  });
});
