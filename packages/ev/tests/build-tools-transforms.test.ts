import { describe, expect, it, vi } from "vitest";
import {
  transformRscClientFile,
  transformServerFile,
} from "../src/build-tools/index.js";
import { RUNTIME } from "../src/build-tools/types.js";

const ROOT = "/project";
const FILE = "/project/src/api/users.server.ts";

const SERVER_FILE = `"use server";

export async function getUsers() {
  return [{ id: "1", name: "Alice" }];
}

export async function createUser(data: { name: string }) {
  return { id: "2", ...data };
}
`;

const NON_SERVER_FILE = `export function helper() { return 42; }`;

describe("transformServerFile", () => {
  describe("client transform", () => {
    it("replaces function bodies with createServerReference stubs", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(RUNTIME.createServerReference);
      expect(result.code).toContain("export const getUsers");
      expect(result.code).toContain("export const createUser");
    });

    it("emits createServerReference calls for each function", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(RUNTIME.createServerReference);
      // Should have a createServerReference call for each exported function
      const refCount = (
        result.code.match(new RegExp(RUNTIME.createServerReference, "g")) || []
      ).length;
      expect(refCount).toBe(3); // import + getUsers + createUser
    });

    it("imports createServerReference from transport module", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(RUNTIME.clientTransportModule);
      expect(result.code).toContain(
        `import { ${RUNTIME.createServerReference} }`,
      );
    });

    it("does not contain original function bodies", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).not.toContain("Alice");
      expect(result.code).not.toContain("return [");
    });
  });

  describe("server transform", () => {
    it("keeps original source code", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
      });

      expect(result.code).toContain('"use server"');
      expect(result.code).toContain("Alice");
      expect(result.code).toContain("export async function getUsers");
    });

    it("appends registerServerReference calls", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
      });

      expect(result.code).toContain(RUNTIME.registerServerReference);
      expect(result.code).toContain(`${RUNTIME.registerServerReference}(`);
      // One registration per exported function
      const registerCount = (
        result.code.match(new RegExp(RUNTIME.registerServerReference, "g")) ||
        []
      ).length;
      // import + 2 registrations = 3
      expect(registerCount).toBe(3);
    });

    it("imports registerServerReference from server module", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
      });

      expect(result.code).toContain(
        `import { ${RUNTIME.registerServerReference} } from "${RUNTIME.serverModule}"`,
      );
    });

    it("calls onServerFn callback for manifest reporting", async () => {
      const onServerFn = vi.fn();
      await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
        onServerFn,
      });

      expect(onServerFn).toHaveBeenCalledTimes(2);
      expect(onServerFn).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{16}$/),
      );
    });
  });

  describe("non-server files", () => {
    it("returns source unchanged for non-use-server files", async () => {
      const result = await transformServerFile(NON_SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toBe(NON_SERVER_FILE);
    });
  });

  describe("client and server produce matching IDs", () => {
    it("generates the same fnId for the same function", async () => {
      const clientResult = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      const serverResult = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
      });

      // Extract hex IDs from both outputs
      const hexPattern = /"([a-f0-9]{16})"/g;
      const clientIds = [...clientResult.code.matchAll(hexPattern)].map(
        (m) => m[1],
      );
      const serverIds = [...serverResult.code.matchAll(hexPattern)].map(
        (m) => m[1],
      );

      expect(clientIds.length).toBeGreaterThan(0);
      const uniqueClientIds = [...new Set(clientIds)].sort();
      const uniqueServerIds = [...new Set(serverIds)].sort();
      expect(uniqueClientIds).toEqual(uniqueServerIds);
    });
  });
});

describe("transformRscClientFile", () => {
  it("turns use-client exports into React client references", async () => {
    const result = await transformRscClientFile(
      `"use client";

      export default function Badge() {
        return null;
      }

      export function Counter() {
        return null;
      }
      `,
      {
        rootContext: ROOT,
        resourcePath: "/project/src/pages/Badge.tsx",
      },
    );

    expect(result.code).toContain(
      `import { registerClientReference } from "react-server-dom-webpack/server.node";`,
    );
    expect(result.code).toContain("file:///project/src/pages/Badge.tsx");
    expect(result.code).toContain('createClientReference("default")');
    expect(result.code).toContain('createClientReference("Counter")');
    expect(result.code).toContain("export default __evjs_client_reference_0");
    expect(result.code).toContain("export const Counter");
  });

  it("leaves non-client files unchanged", async () => {
    const source = `export function helper() { return 1; }`;
    await expect(
      transformRscClientFile(source, {
        rootContext: ROOT,
        resourcePath: "/project/src/helper.ts",
      }),
    ).resolves.toEqual({ code: source });
  });
});
