import { describe, expect, it } from "vitest";
import { detectUseServer, makeFnId, parseModuleRef } from "../src/utils.js";

describe("detectUseServer", () => {
  it("detects 'use server' directive with double quotes", () => {
    expect(detectUseServer('"use server";\nexport function foo() {}')).toBe(
      true,
    );
  });

  it("detects 'use server' directive with single quotes", () => {
    expect(detectUseServer("'use server';\nexport function foo() {}")).toBe(
      true,
    );
  });

  it("detects directive with leading whitespace", () => {
    expect(
      detectUseServer('  \n  "use server";\nexport function foo() {}'),
    ).toBe(true);
  });

  it("detects directive with leading comments", () => {
    expect(
      detectUseServer('// comment\n"use server";\nexport function foo() {}'),
    ).toBe(true);
    expect(
      detectUseServer('/* block */\n"use server";\nexport function foo() {}'),
    ).toBe(true);
  });

  it("returns false for non-use-server files", () => {
    expect(detectUseServer("export function foo() {}")).toBe(false);
    expect(detectUseServer('const x = "use server";')).toBe(false);
  });

  it("returns false for empty source", () => {
    expect(detectUseServer("")).toBe(false);
  });
});

describe("makeFnId", () => {
  it("produces a 16-character hex string", () => {
    const id = makeFnId("/root", "/root/src/api/users.server.ts", "getUsers");
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("produces stable IDs for the same input", () => {
    const id1 = makeFnId("/root", "/root/src/api/users.server.ts", "getUsers");
    const id2 = makeFnId("/root", "/root/src/api/users.server.ts", "getUsers");
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different exports", () => {
    const id1 = makeFnId("/root", "/root/src/api/users.server.ts", "getUsers");
    const id2 = makeFnId(
      "/root",
      "/root/src/api/users.server.ts",
      "createUser",
    );
    expect(id1).not.toBe(id2);
  });

  it("produces different IDs for different files", () => {
    const id1 = makeFnId("/root", "/root/src/api/users.server.ts", "getUsers");
    const id2 = makeFnId("/root", "/root/src/api/posts.server.ts", "getUsers");
    expect(id1).not.toBe(id2);
  });

  it("uses relative path so IDs are machine-independent", () => {
    const id1 = makeFnId(
      "/home/alice/project",
      "/home/alice/project/src/api.ts",
      "fn",
    );
    const id2 = makeFnId(
      "/home/bob/project",
      "/home/bob/project/src/api.ts",
      "fn",
    );
    expect(id1).toBe(id2);
  });
});

describe("parseModuleRef", () => {
  it("parses module#export format", () => {
    const ref = parseModuleRef("@evjs/server#createApp");
    expect(ref).toEqual({
      module: "@evjs/server",
      exportName: "createApp",
    });
  });

  it("handles export names with special characters", () => {
    const ref = parseModuleRef("./local#myFn");
    expect(ref).toEqual({ module: "./local", exportName: "myFn" });
  });

  it("throws on missing # separator", () => {
    expect(() => parseModuleRef("@evjs/server")).toThrow(/Expected format/);
  });
});
