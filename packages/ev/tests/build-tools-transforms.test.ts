import { describe, expect, it, vi } from "vitest";
import {
  detectUseClient,
  extractRscReferences,
  extractServerFunctionExports,
  transformRscClientFile,
  transformServerFile,
} from "../src/_internal/build/index.js";
import { SERVER_FUNCTION_TRANSFORM_RUNTIME } from "../src/_internal/build/types.js";

const runtime = SERVER_FUNCTION_TRANSFORM_RUNTIME;

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

const MALFORMED_SERVER_FILE = `"use server";

export async function saveUser( {
`;

describe("transformServerFile", () => {
  describe("client transform", () => {
    it("replaces function bodies with createServerReference stubs", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(runtime.createServerReference);
      expect(result.code).toContain("export { EvServerFn_0 as getUsers }");
      expect(result.code).toContain("export { EvServerFn_1 as createUser }");
    });

    it("emits createServerReference calls for each function", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(runtime.createServerReference);
      // Should have a createServerReference call for each exported function
      const refCount = (
        result.code.match(new RegExp(runtime.createServerReference, "g")) || []
      ).length;
      expect(refCount).toBe(3); // import + getUsers + createUser
    });

    it("emits server function arity metadata in client stubs", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toMatch(
        new RegExp(
          `${runtime.createServerReference}\\("[a-f0-9]{16}", "getUsers", 0\\)`,
        ),
      );
      expect(result.code).toMatch(
        new RegExp(
          `${runtime.createServerReference}\\("[a-f0-9]{16}", "createUser", 1\\)`,
        ),
      );
    });

    it("omits arity metadata for flexible server function signatures", async () => {
      const result = await transformServerFile(
        `"use server";

        export async function searchUsers(query: string, options = {}) {
          return { query, options };
        }

        export const saveTags = async (...tags: string[]) => tags;

        export async function maybeUser(id?: string) {
          return id;
        }
        `,
        {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: false,
        },
      );

      expect(result.code).toMatch(
        new RegExp(
          `${runtime.createServerReference}\\("[a-f0-9]{16}", "searchUsers"\\)`,
        ),
      );
      expect(result.code).toMatch(
        new RegExp(
          `${runtime.createServerReference}\\("[a-f0-9]{16}", "saveTags"\\)`,
        ),
      );
      expect(result.code).toMatch(
        new RegExp(
          `${runtime.createServerReference}\\("[a-f0-9]{16}", "maybeUser"\\)`,
        ),
      );
    });

    it("imports createServerReference from the generated server function runtime module", async () => {
      const result = await transformServerFile(SERVER_FILE, {
        resourcePath: FILE,
        rootContext: ROOT,
        isServer: false,
      });

      expect(result.code).toContain(runtime.clientModule);
      expect(result.code).toContain(
        `import { ${runtime.createServerReference} }`,
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

    it("supports const function exports and same-module aliases", async () => {
      const result = await transformServerFile(
        `"use server";

        export const getUser = async () => ({ id: "1" });
        const saveUser = async () => ({ ok: true });
        export { saveUser as updateUser };
        export type { UserInput } from "./types";
        `,
        {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: false,
        },
      );

      expect(result.code).toContain("export { EvServerFn_0 as getUser }");
      expect(result.code).toContain("export { EvServerFn_1 as updateUser }");
      expect(result.code).not.toContain("UserInput");
      expect(result.code).not.toContain("saveUser");
      expect(result.code).not.toContain('{ id: "1" }');
    });

    it("allows type-only declarations in use-server modules", async () => {
      const result = await transformServerFile(
        `"use server";

        export interface UserInput {
          name: string;
        }

        export type UserResult = { id: string };

        export async function saveUser(input: UserInput): Promise<UserResult> {
          return { id: input.name };
        }
        `,
        {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: false,
        },
      );

      expect(result.code).toContain("export { EvServerFn_0 as saveUser }");
      expect(result.code).not.toContain("UserInput");
      expect(result.code).not.toContain("UserResult");
    });

    it("rejects use-server modules without callable exports", async () => {
      await expect(
        transformServerFile(
          `"use server";

          type UserInput = {
            name: string;
          };
          export type { UserInput };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" modules must export at least one named server function. Add an exported function or remove the directive.',
      );

      await expect(
        transformServerFile(
          `"use server";

          async function saveUser() {
            return { ok: true };
          }
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: true,
          },
        ),
      ).rejects.toThrow(
        '"use server" modules must export at least one named server function. Add an exported function or remove the directive.',
      );
    });

    it("rejects modules that combine use-server and use-client directives", async () => {
      await expect(
        transformServerFile(
          `"use client";
          "use server";

          export async function saveUser() {
            return { ok: true };
          }
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use client" and "use server" directives cannot be used in the same module. Split client references and server functions into separate files.',
      );
    });

    it("rejects malformed use-server modules with a framework error", async () => {
      await expect(
        transformServerFile(MALFORMED_SERVER_FILE, {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: false,
        }),
      ).rejects.toThrow("Server function module could not be parsed:");

      await expect(
        transformServerFile(MALFORMED_SERVER_FILE, {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: true,
        }),
      ).rejects.toThrow("Server function module could not be parsed:");
    });

    it("rejects runtime non-function exports in use-server modules", async () => {
      await expect(
        transformServerFile(
          `"use server";

          export class UserService {}
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "UserService" must be a function declaration or a const initialized to a function.',
      );

      await expect(
        transformServerFile(
          `"use server";

          export enum UserKind {
            Admin,
          }
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "UserKind" must be a function declaration or a const initialized to a function.',
      );

      await expect(
        transformServerFile(
          `"use server";

          export namespace UserApi {
            export const version = "1";
          }
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "UserApi" must be a function declaration or a const initialized to a function.',
      );
    });

    it("rejects generator server function exports", async () => {
      await expect(
        transformServerFile(
          `"use server";

          export function* streamUsers() {
            yield { id: "1" };
          }
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "streamUsers" cannot be a generator function. Server functions must return a value or Promise, not an iterator.',
      );

      await expect(
        transformServerFile(
          `"use server";

          export const streamUsers = function* () {
            yield { id: "1" };
          };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "streamUsers" cannot be a generator function. Server functions must return a value or Promise, not an iterator.',
      );

      await expect(
        transformServerFile(
          `"use server";

          async function* streamUsers() {
            yield { id: "1" };
          }
          export { streamUsers as listUsers };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: true,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "listUsers" cannot be a generator function. Server functions must return a value or Promise, not an iterator.',
      );
    });

    it("rejects TypeScript export assignment forms in use-server modules", async () => {
      await expect(
        transformServerFile(
          `"use server";

          const saveUser = async () => ({ ok: true });
          export = saveUser;
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" modules cannot use export assignment. Export named server functions instead.',
      );

      await expect(
        transformServerFile(
          `"use server";

          export as namespace ServerFns;
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" modules cannot use namespace export declarations. Export named server functions instead.',
      );
    });

    it("rejects ambient server function exports", async () => {
      await expect(
        transformServerFile(
          `"use server";

          export declare function saveUser(): Promise<void>;
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "saveUser" must include a runtime function implementation. Ambient declare exports are type-only.',
      );

      await expect(
        transformServerFile(
          `"use server";

          declare function saveUser(): Promise<void>;
          export { saveUser };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "saveUser" must include a runtime function implementation. Ambient declare exports are type-only.',
      );

      await expect(
        transformServerFile(
          `"use server";

          declare const saveUser: () => Promise<void>;
          export { saveUser as updateUser };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "updateUser" must include a runtime function implementation. Ambient declare exports are type-only.',
      );
    });

    it("rejects bare export-star server function re-exports", async () => {
      await expect(
        transformServerFile(
          `"use server";

          export type * from "./types";
          export * from "./impl";
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" modules cannot use bare export * re-exports. Export named server functions from the defining module.',
      );
    });

    it("emits valid client stubs for reserved-word and string-literal aliases", async () => {
      const result = await transformServerFile(
        `"use server";

        const saveUser = async () => ({ ok: true });
        export { saveUser as class };
        export { saveUser as "save-user" };
        `,
        {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: false,
        },
      );

      expect(result.code).toContain("export { EvServerFn_0 as class }");
      expect(result.code).toContain('export { EvServerFn_1 as "save-user" }');
      expect(result.code).not.toContain("export const class");
      expect(result.code).not.toContain("saveUser");
    });

    it("rejects whitespace-padded string-literal server function export names", async () => {
      await expect(
        transformServerFile(
          `"use server";

          const saveUser = async () => ({ ok: true });
          export { saveUser as " save-user" };
          export { saveUser as "save-user " };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export name " save-user" must be a non-empty string without leading or trailing whitespace.',
      );
    });

    it("rejects duplicate server function export names", async () => {
      await expect(
        transformServerFile(
          `"use server";

          const saveUser = async () => ({ ok: true });
          export { saveUser as updateUser };
          export { saveUser as updateUser };
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "updateUser" is declared more than once. Server function export names must be unique.',
      );
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

      expect(result.code).toContain(runtime.registerServerReference);
      expect(result.code).toContain(`${runtime.registerServerReference}(`);
      // One registration per exported function
      const registerCount = (
        result.code.match(new RegExp(runtime.registerServerReference, "g")) ||
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
        `import { ${runtime.registerServerReference} } from "${runtime.serverModule}"`,
      );
    });

    it("preserves server directives before injected registration imports", async () => {
      const result = await transformServerFile(
        `"use strict";
        "use server";

        export async function getUsers() {
          return [];
        }
        `,
        {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: true,
        },
      );

      expect(result.code).toMatch(
        new RegExp(
          `^"use strict";\\n"use server";\\nimport \\{ ${runtime.registerServerReference} \\}`,
        ),
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

    it("registers same-module aliases with their local implementation", async () => {
      const result = await transformServerFile(
        `"use server";

        const saveUser = async () => ({ ok: true });
        export { saveUser as updateUser };
        export { saveUser as "save-user" };
        `,
        {
          resourcePath: FILE,
          rootContext: ROOT,
          isServer: true,
        },
      );

      expect(result.code).toContain(
        `${runtime.registerServerReference}(saveUser,`,
      );
      expect(result.code).toContain('"updateUser"');
      expect(result.code).toContain('"save-user"');
      expect(result.code).not.toContain(
        `${runtime.registerServerReference}(updateUser,`,
      );
    });

    it("rejects default exports and non-function exports", async () => {
      await expect(
        transformServerFile(
          `"use server";

          export default async function getUser() {
            return null;
          }
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: true,
          },
        ),
      ).rejects.toThrow(
        '"use server" modules cannot default-export server functions. Export a named function instead.',
      );

      await expect(
        transformServerFile(
          `"use server";

          export const VERSION = "1";
          `,
          {
            resourcePath: FILE,
            rootContext: ROOT,
            isServer: false,
          },
        ),
      ).rejects.toThrow(
        '"use server" export "VERSION" must be a function declaration or a const initialized to a function.',
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

describe("extractServerFunctionExports", () => {
  it("returns exported server function names", () => {
    expect(
      extractServerFunctionExports(`"use server";

        export async function getUsers() {
          return [];
        }

        const saveUser = async () => ({ ok: true });
        export { saveUser as updateUser };
      `),
    ).toEqual(["getUsers", "updateUser"]);
  });

  it("returns no exports for modules without use-server", () => {
    expect(extractServerFunctionExports(NON_SERVER_FILE)).toEqual([]);
  });

  it("throws a framework parse error for malformed use-server modules", () => {
    expect(() => extractServerFunctionExports(MALFORMED_SERVER_FILE)).toThrow(
      "Server function module could not be parsed:",
    );
  });

  it("throws semantic diagnostics for invalid use-server modules", () => {
    expect(() =>
      extractServerFunctionExports(`"use server";

        export const VERSION = "1";
      `),
    ).toThrow(
      '"use server" export "VERSION" must be a function declaration or a const initialized to a function.',
    );

    expect(() =>
      extractServerFunctionExports(`"use server";

        export type UserInput = { name: string };
      `),
    ).toThrow(
      '"use server" modules must export at least one named server function. Add an exported function or remove the directive.',
    );
  });
});

describe("extractRscReferences", () => {
  it("reports server-function diagnostics for invalid use-server modules", () => {
    const analysis = extractRscReferences(
      `"use server";

      export const VERSION = "1";
      `,
      "src/actions.ts",
    );

    expect(analysis.clientReferences).toEqual([]);
    expect(analysis.serverReferences).toEqual([]);
    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        message:
          '"use server" export "VERSION" must be a function declaration or a const initialized to a function.',
      },
    ]);
  });
});

describe("transformRscClientFile", () => {
  it("detects use-client directives after file headers", async () => {
    const header = `/* ${"license ".repeat(80)} */`;
    const source = `${header}
      "use strict";
      "use client";

      export function HeaderWidget() {
        return null;
      }
    `;

    expect(detectUseClient(source)).toBe(true);

    const result = await transformRscClientFile(source, {
      rootContext: ROOT,
      resourcePath: "/project/src/pages/HeaderWidget.tsx",
    });

    expect(result.code).toContain('createClientReference("HeaderWidget")');
    expect(result.code).toContain(
      "export { __evjs_client_reference_0 as HeaderWidget }",
    );
  });

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
    expect(result.code).toContain(
      "export { __evjs_client_reference_1 as Counter }",
    );
  });

  it("emits valid RSC client references for reserved-word and string-literal aliases", async () => {
    const result = await transformRscClientFile(
      `"use client";

      function Widget() {
        return null;
      }

      export { Widget as class };
      export { Widget as "client-widget" };
      `,
      {
        rootContext: ROOT,
        resourcePath: "/project/src/pages/Widget.tsx",
      },
    );

    expect(result.code).toContain('createClientReference("class")');
    expect(result.code).toContain('createClientReference("client-widget")');
    expect(result.code).toContain(
      "export { __evjs_client_reference_0 as class }",
    );
    expect(result.code).toContain(
      'export { __evjs_client_reference_1 as "client-widget" }',
    );
    expect(result.code).not.toContain("export const class");
  });

  it("emits RSC client references for class exports and re-exported names", async () => {
    const result = await transformRscClientFile(
      `"use client";

      export class LegacyWidget {}
      export * as WidgetSet from "./widgets";
      export { default as Card } from "./Card";
      export { Widget as "client-widget" } from "./Widget";
      export type { WidgetProps } from "./Widget";
      `,
      {
        rootContext: ROOT,
        resourcePath: "/project/src/pages/ClientIndex.tsx",
      },
    );

    expect(result.code).toContain('createClientReference("LegacyWidget")');
    expect(result.code).toContain('createClientReference("WidgetSet")');
    expect(result.code).toContain('createClientReference("Card")');
    expect(result.code).toContain('createClientReference("client-widget")');
    expect(result.code).not.toContain('createClientReference("WidgetProps")');
    expect(result.code).toContain(
      "export { __evjs_client_reference_0 as LegacyWidget }",
    );
    expect(result.code).toContain(
      "export { __evjs_client_reference_1 as WidgetSet }",
    );
    expect(result.code).toContain(
      "export { __evjs_client_reference_2 as Card }",
    );
    expect(result.code).toContain(
      'export { __evjs_client_reference_3 as "client-widget" }',
    );
  });

  it("rejects bare RSC client export-star re-exports", async () => {
    await expect(
      transformRscClientFile(
        `"use client";

        export type * from "./types";
        export * from "./widgets";
        `,
        {
          rootContext: ROOT,
          resourcePath: "/project/src/pages/ClientIndex.tsx",
        },
      ),
    ).rejects.toThrow(
      '"use client" modules cannot use bare export * from "./widgets" because client reference names must be statically known. Use explicit named exports or a namespace re-export such as export * as Widgets from "./widgets".',
    );
  });

  it("rejects modules that combine use-client and use-server directives", async () => {
    await expect(
      transformRscClientFile(
        `"use client";
        "use server";

        export function Widget() {
          return null;
        }
        `,
        {
          rootContext: ROOT,
          resourcePath: "/project/src/pages/Widget.tsx",
        },
      ),
    ).rejects.toThrow(
      '"use client" and "use server" directives cannot be used in the same module. Split client references and server functions into separate files.',
    );
  });

  it("rejects malformed use-client modules with a framework error", async () => {
    await expect(
      transformRscClientFile(
        `"use client";

        export default function BrokenClient( {
        `,
        {
          rootContext: ROOT,
          resourcePath: "/project/src/pages/BrokenClient.client.tsx",
        },
      ),
    ).rejects.toThrow("RSC reference module could not be parsed:");
  });

  it("rejects use-client modules with only ambient exports", async () => {
    await expect(
      transformRscClientFile(
        `"use client";

        export declare function DirectWidget(): unknown;
        export declare class LegacyWidget {}

        declare class LocalWidget {}
        export { LocalWidget as "local-widget" };
        `,
        {
          rootContext: ROOT,
          resourcePath: "/project/src/pages/AmbientWidget.tsx",
        },
      ),
    ).rejects.toThrow(
      '"use client" modules must export at least one runtime client reference. Add a default export, named export, or explicit re-export; otherwise remove the directive.',
    );
  });

  it("rejects use-client modules without runtime exports", async () => {
    await expect(
      transformRscClientFile(
        `"use client";

        export type { WidgetProps } from "./types";

        function Widget() {
          return null;
        }
        `,
        {
          rootContext: ROOT,
          resourcePath: "/project/src/pages/LocalOnlyWidget.tsx",
        },
      ),
    ).rejects.toThrow(
      '"use client" modules must export at least one runtime client reference. Add a default export, named export, or explicit re-export; otherwise remove the directive.',
    );
  });

  it("de-duplicates repeated RSC client export names", async () => {
    const result = await transformRscClientFile(
      `"use client";

      function Widget() {
        return null;
      }

      export { Widget };
      export { Widget as Widget };
      `,
      {
        rootContext: ROOT,
        resourcePath: "/project/src/pages/DuplicateWidget.tsx",
      },
    );

    expect(
      result.code.match(/createClientReference\("Widget"\)/g),
    ).toHaveLength(1);
    expect(result.code.match(/ as Widget/g)).toHaveLength(1);
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
