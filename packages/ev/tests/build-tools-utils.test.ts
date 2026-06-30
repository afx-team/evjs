import { describe, expect, it } from "vitest";
import {
  deriveRouteIdFromPath,
  detectUseServer,
  hashServerFunction,
  makeFnId,
  parseModuleRef,
  sanitizePageId,
} from "../src/_internal/build/utils.js";

describe("deriveRouteIdFromPath", () => {
  it("uses index for the root route", () => {
    expect(deriveRouteIdFromPath("/")).toBe("index");
  });

  it("normalizes nested and dynamic route paths", () => {
    expect(deriveRouteIdFromPath("/orders/$orderId")).toBe("orders_orderId");
    expect(deriveRouteIdFromPath("/$slug")).toBe("slug");
  });

  it("normalizes punctuation and separators to underscores", () => {
    expect(deriveRouteIdFromPath("/admin/panel")).toBe("admin_panel");
    expect(deriveRouteIdFromPath("/admin_panel")).toBe("admin_panel");
    expect(deriveRouteIdFromPath("/docs/v1.0")).toBe("docs_v1_0");
  });
});

describe("sanitizePageId", () => {
  it("normalizes existing page ids for build artifact names", () => {
    expect(sanitizePageId("campaign:offer")).toBe("campaign_offer");
    expect(sanitizePageId("campaign/offer")).toBe("campaign_offer");
    expect(sanitizePageId("campaign-offer")).toBe("campaign-offer");
  });
});

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

  it("detects directive after long leading comments", () => {
    const header = `/* ${"license ".repeat(80)} */`;
    expect(
      detectUseServer(`${header}\n"use server";\nexport function foo() {}`),
    ).toBe(true);
  });

  it("detects directive after earlier directive prologue entries", () => {
    expect(
      detectUseServer('"use strict";\n"use server";\nexport function foo() {}'),
    ).toBe(true);
  });

  it("detects malformed server files so real parse errors can surface later", () => {
    expect(detectUseServer('"use server";\nexport function broken( {')).toBe(
      true,
    );
  });

  it("returns false for non-use-server files", () => {
    expect(detectUseServer("export function foo() {}")).toBe(false);
    expect(detectUseServer('const x = "use server";')).toBe(false);
    expect(detectUseServer('"use server" + suffix;\nexport const x = 1;')).toBe(
      false,
    );
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

  it("matches Utoopack action IDs for module id plus export name", () => {
    expect(
      hashServerFunction("examples/basic/src/api/users.server.ts", "getUsers"),
    ).toBe("e13cfee54cd1fded");
    expect(
      makeFnId(
        "/repo",
        "/repo/examples/basic/src/api/users.server.ts",
        "getUsers",
      ),
    ).toBe("e13cfee54cd1fded");
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
