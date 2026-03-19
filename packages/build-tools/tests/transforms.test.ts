import { describe, expect, it, vi } from "vitest";
import { transformServerFile } from "../src/transforms/index.js";
import { RUNTIME } from "../src/types.js";

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
    it("replaces function bodies with __fn_call stubs", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(RUNTIME.clientCall);
      expect(result.code).toContain("export function getUsers");
      expect(result.code).toContain("export function createUser");
    });

    it("emits __fn_register calls for each function", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(RUNTIME.clientRegister);
      // Should have an __fn_register call for each exported function
      const registerCount = (
        result.code.match(new RegExp(RUNTIME.clientRegister, "g")) || []
      ).length;
      expect(registerCount).toBe(3); // import + getUsers + createUser
    });

    it("imports __fn_call and __fn_register from transport module", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(RUNTIME.clientTransportModule);
      expect(result.code).toContain(
        `import { ${RUNTIME.clientCall}, ${RUNTIME.clientRegister} }`,
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

    it("appends registerServerFn calls", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
      });

      expect(result.code).toContain(RUNTIME.registerServerFn);
      expect(result.code).toContain(`${RUNTIME.registerServerFn}(`);
      // One registration per exported function
      const registerCount = (
        result.code.match(new RegExp(RUNTIME.registerServerFn, "g")) || []
      ).length;
      // import + 2 registrations = 3
      expect(registerCount).toBe(3);
    });

    it("imports registerServerFn from server module", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: true,
      });

      expect(result.code).toContain(
        `import { ${RUNTIME.registerServerFn} } from "${RUNTIME.serverModule}"`,
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
        expect.objectContaining({ export: "getUsers" }),
      );
      expect(onServerFn).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{16}$/),
        expect.objectContaining({ export: "createUser" }),
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
