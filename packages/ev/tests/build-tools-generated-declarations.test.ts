import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectFrameworkBuild,
  prepareFrameworkBuild,
} from "../src/_internal/build/commands.js";
import type {
  GeneratedModuleDeclaration,
  Plugin,
} from "../src/plugin/index.js";

const tempDirs: string[] = [];
const typescriptBin = process.env.EVJS_TEST_TYPESCRIPT_BIN
  ? path.resolve(process.env.EVJS_TEST_TYPESCRIPT_BIN)
  : createRequire(import.meta.url).resolve("typescript/bin/tsc");

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("generated contribution declarations", () => {
  it("keeps inspect mode free of declaration discovery side effects", async () => {
    const cwd = await createProject();
    await inspectFrameworkBuild(createDeclarationConfig(), {
      command: "build",
      cwd,
    });

    await expect(fs.access(path.join(cwd, ".ev"))).rejects.toThrow();
    await expect(
      fs.access(path.join(cwd, "src/evjs-env.d.ts")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(cwd, "src/.ev/types"))).rejects.toThrow();
  });

  it("materializes exact named exports for strict rootDir projects without paths", async () => {
    const cwd = await createProject();
    const declarationSchemaFile = path.join(cwd, "src/declaration-schema.ts");
    await fs.writeFile(
      declarationSchemaFile,
      [
        "export const databaseShape = { tables: { customers: { id: 1 as number } } } as const;",
        "export type DatabaseShape = { public: { Tables: { customers: { Row: { id: number } } } } };",
        "",
      ].join("\n"),
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "exact-declarations",
      contributions(ctx) {
        const databaseModule = ctx.emit.module({
          id: "database",
          scope: { kind: "server" },
          source: [
            "export const database = { tables: { customers: { id: 1 as number } } } as const;",
            "export type Database = { public: { Tables: { customers: { Row: { id: number } } } } };",
          ].join("\n"),
          declarationSource({ importFile }) {
            const schema = importFile(declarationSchemaFile);
            return [
              `export declare const database: typeof import(${JSON.stringify(schema)}).databaseShape;`,
              `export type Database = import(${JSON.stringify(schema)}).DatabaseShape;`,
            ].join("\n");
          },
        });
        const declaration = {
          exports: [
            { kind: "value" as const, name: "database" },
            {
              kind: "type" as const,
              name: "Database",
              typeParameters: "none" as const,
            },
          ],
        };
        ctx.slot("resolve.alias").add({
          id: "database-alias",
          specifier: "evdb:database",
          replacement: databaseModule,
          declaration,
        });
        const [firstExport] = declaration.exports;
        if (firstExport) firstExport.name = "mutated-after-add";
      },
    };
    const prepared = await prepareFrameworkBuild(
      { ...createBaseConfig(), plugins: [plugin] },
      { cwd },
    );
    await prepared.dispose();

    const typesFile = path.join(cwd, ".ev/types.d.ts");
    const generatedTypes = await fs.readFile(typesFile, "utf-8");
    const manifest = JSON.parse(
      await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as {
      generated?: {
        modules?: Array<Record<string, unknown>>;
        slots?: Array<Record<string, unknown>>;
      };
    };
    expect(manifest.generated?.modules).toContainEqual(
      expect.objectContaining({
        id: "database",
        declarationFile: "./src/.ev/types/exact-declarations/database.d.ts",
        sourceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(manifest.generated?.slots).toContainEqual(
      expect.objectContaining({
        slot: "resolve.alias",
        specifier: "evdb:database",
        declaration: {
          exports: [
            { kind: "value", name: "database" },
            {
              kind: "type",
              name: "Database",
              typeParameters: "none",
            },
          ],
        },
      }),
    );
    expect(generatedTypes).toContain('declare module "evdb:database" {');
    expect(generatedTypes).toContain(
      'export const database: typeof import("../src/.ev/types/exact-declarations/database.js").database;',
    );
    expect(generatedTypes).toContain(
      'export type Database = import("../src/.ev/types/exact-declarations/database.js").Database;',
    );
    expect(generatedTypes).not.toMatch(/\bany\b/u);
    expect(generatedTypes).not.toContain(
      ".ev/plugins/exact-declarations/database",
    );
    await expect(
      fs.readFile(
        path.join(cwd, "src/.ev/types/exact-declarations/database.d.ts"),
        "utf-8",
      ),
    ).resolves.toContain(
      'typeof import("../../../declaration-schema").databaseShape',
    );
    await expect(
      fs.readFile(path.join(cwd, "src/evjs-env.d.ts"), "utf-8"),
    ).resolves.toContain('/// <reference path="../.ev/types.d.ts" />');

    await fs.writeFile(
      path.join(cwd, "src/consumer.ts"),
      [
        'import { database, type Database } from "evdb:database";',
        "type Equal<TLeft, TRight> =",
        "  (<T>() => T extends TLeft ? 1 : 2) extends",
        "  (<T>() => T extends TRight ? 1 : 2) ? true : false;",
        "type Expect<T extends true> = T;",
        "type IsAny<T> = 0 extends 1 & T ? true : false;",
        "type DatabaseIsExact = Expect<Equal<IsAny<Database>, false>>;",
        "type ValueIsExact = Expect<Equal<IsAny<typeof database>, false>>;",
        "type RowIsExact = Expect<",
        "  Equal<Database['public']['Tables']['customers']['Row'], { id: number }>",
        ">;",
        "const id: number = database.tables.customers.id;",
        "// @ts-expect-error exact generated value types reject a string",
        "const invalidId: string = database.tables.customers.id;",
        "export type Assertions = DatabaseIsExact | ValueIsExact | RowIsExact;",
        "void id;",
        "void invalidId;",
        "",
      ].join("\n"),
      "utf-8",
    );
    const tsconfigFile = path.join(cwd, "tsconfig.json");
    await fs.writeFile(
      tsconfigFile,
      `${JSON.stringify(
        {
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            rootDir: "./src",
            skipLibCheck: false,
            strict: true,
            target: "ES2022",
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    await expect(
      execa(process.execPath, [typescriptBin, "-p", tsconfigFile]),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it("keeps unchanged companions stable and removes owned discovery state", async () => {
    const cwd = await createProject();
    const first = await prepareFrameworkBuild(createDeclarationConfig(), {
      cwd,
    });
    await first.dispose();
    const discoveryFile = path.join(cwd, "src/evjs-env.d.ts");
    const companionFile = path.join(
      cwd,
      "src/.ev/types/discovery-declaration/database.d.ts",
    );
    const oldTimestamp = new Date("2000-01-01T00:00:00.000Z");
    await Promise.all(
      [discoveryFile, companionFile].map((file) =>
        fs.utimes(file, oldTimestamp, oldTimestamp),
      ),
    );

    const second = await prepareFrameworkBuild(createDeclarationConfig(), {
      cwd,
    });
    await second.dispose();
    expect((await fs.stat(discoveryFile)).mtime.getTime()).toBe(
      oldTimestamp.getTime(),
    );
    expect((await fs.stat(companionFile)).mtime.getTime()).toBe(
      oldTimestamp.getTime(),
    );

    const withoutDeclaration = await prepareFrameworkBuild(createBaseConfig(), {
      cwd,
    });
    await withoutDeclaration.dispose();
    await expect(fs.access(discoveryFile)).rejects.toThrow();
    await expect(fs.access(companionFile)).rejects.toThrow();
    await expect(fs.access(path.join(cwd, "src/.ev/types"))).rejects.toThrow();
  });

  it("preserves user-owned discovery and companion paths", async () => {
    const discoveryProject = await createProject();
    const discoveryFile = path.join(discoveryProject, "src/evjs-env.d.ts");
    const userDiscovery = "declare const userOwnedEnvironment: true;\n";
    await fs.writeFile(discoveryFile, userDiscovery, "utf-8");
    await expect(
      prepareFrameworkBuild(createDeclarationConfig(), {
        cwd: discoveryProject,
      }),
    ).rejects.toThrow("Refusing to overwrite user-authored");
    await expect(fs.readFile(discoveryFile, "utf-8")).resolves.toBe(
      userDiscovery,
    );
    await expect(
      fs.access(path.join(discoveryProject, "src/.ev/types")),
    ).rejects.toThrow();

    const companionProject = await createProject();
    const userDirectory = path.join(companionProject, "src/.ev/types");
    const userFile = path.join(userDirectory, "user.d.ts");
    await fs.mkdir(userDirectory, { recursive: true });
    await fs.writeFile(userFile, "export type UserOwned = true;\n", "utf-8");
    await expect(
      prepareFrameworkBuild(createDeclarationConfig(), {
        cwd: companionProject,
      }),
    ).rejects.toThrow("Refusing to overwrite user-authored");
    await expect(fs.readFile(userFile, "utf-8")).resolves.toBe(
      "export type UserOwned = true;\n",
    );
  });

  it("validates companion sources and exact declaration metadata", async () => {
    const cwd = await createProject();
    const missingCompanion: Plugin<Record<string, never>> = {
      name: "missing-companion",
      contributions(ctx) {
        const module = ctx.emit.module({
          id: "database",
          scope: { kind: "server" },
          source: "export const database = 1;",
        });
        ctx.slot("resolve.alias").add({
          id: "database-alias",
          specifier: "evdb:database",
          replacement: module,
          declaration: {
            exports: [{ kind: "value", name: "database" }],
          },
        });
      },
    };
    await expect(
      prepareFrameworkBuild(
        { ...createBaseConfig(), plugins: [missingCompanion] },
        { cwd },
      ),
    ).rejects.toThrow("requires its generated TypeScript module to supply");

    const nonTypeScript: Plugin<Record<string, never>> = {
      name: "non-typescript-companion",
      contributions(ctx) {
        ctx.emit.module({
          id: "runtime",
          scope: { kind: "server" },
          extension: ".js",
          source: "export const runtime = true;",
          declarationSource: "export declare const runtime: true;",
        });
      },
    };
    await expect(
      prepareFrameworkBuild(
        { ...createBaseConfig(), plugins: [nonTypeScript] },
        { cwd },
      ),
    ).rejects.toThrow(
      "can only supply declarationSource for a TypeScript module",
    );

    const malformed: Plugin<Record<string, never>> = {
      name: "malformed-companion",
      contributions(ctx) {
        ctx.emit.module({
          id: "runtime",
          scope: { kind: "server" },
          source: "export const runtime = true;",
          declarationSource: "\0",
        });
      },
    };
    await expect(
      prepareFrameworkBuild(
        { ...createBaseConfig(), plugins: [malformed] },
        { cwd },
      ),
    ).rejects.toThrow("must be non-empty declaration-module source");

    const outsideSource = path.join(cwd, "outside.ts");
    await fs.writeFile(outsideSource, "export type Outside = true;\n", "utf-8");
    const escapedImport: Plugin<Record<string, never>> = {
      name: "escaped-companion-import",
      contributions(ctx) {
        ctx.emit.module({
          id: "runtime",
          scope: { kind: "server" },
          source: "export const runtime = true;",
          declarationSource({ importFile }) {
            return `export type Outside = import(${JSON.stringify(importFile(outsideSource))}).Outside;`;
          },
        });
      },
    };
    await expect(
      prepareFrameworkBuild(
        { ...createBaseConfig(), plugins: [escapedImport] },
        { cwd },
      ),
    ).rejects.toThrow("must stay inside application source root");

    await expectRejectedRawDeclaration(
      {
        exports: [{ kind: "type", name: "Database" }],
      },
      'typeParameters must be exactly "none"',
    );
    await expectRejectedRawDeclaration(
      {
        exports: [{ kind: "value", name: "database", as: "renamedDatabase" }],
      },
      'contains unexpected field "as"',
    );
    await expectInvalidDeclaration(
      {
        id: "wildcard",
        specifier: "evdb:*",
        declaration: {
          exports: [{ kind: "value", name: "database" }],
        },
      },
      "exact non-relative module specifier",
    );
    await expectInvalidDeclaration(
      {
        id: "duplicate-export",
        specifier: "evdb:duplicate-export",
        declaration: {
          exports: [
            { kind: "value", name: "database" },
            {
              kind: "type",
              name: "database",
              typeParameters: "none",
            },
          ],
        },
      },
      'duplicate name "database"',
    );
  });

  it("rejects exact declaration aliases that conflict with other resolvers", async () => {
    const cwd = await createProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "declaration-conflict",
      contributions(ctx) {
        const first = ctx.emit.module({
          id: "first",
          scope: { kind: "server" },
          source: "export const database = 1;",
          declarationSource: "export declare const database: 1;",
        });
        const second = ctx.emit.module({
          id: "second",
          scope: { kind: "server" },
          source: "export const database = 2;",
        });
        ctx.slot("resolve.alias").add({
          id: "first-alias",
          specifier: "evdb:database",
          replacement: first,
          declaration: {
            exports: [{ kind: "value", name: "database" }],
          },
        });
        ctx.slot("resolve.alias").add({
          id: "second-alias",
          specifier: "evdb:database",
          replacement: second,
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        { ...createBaseConfig(), plugins: [plugin] },
        { cwd },
      ),
    ).rejects.toThrow(
      'conflicts with exact declared module "evdb:database" from declaration-conflict:first-alias',
    );
  });
});

async function expectInvalidDeclaration(
  input: {
    id: string;
    specifier: string;
    declaration: GeneratedModuleDeclaration;
  },
  message: string,
): Promise<void> {
  const cwd = await createProject();
  const plugin: Plugin<Record<string, never>> = {
    name: `invalid-${input.id}`,
    contributions(ctx) {
      const module = ctx.emit.module({
        id: "database",
        scope: { kind: "server" },
        source: "export const database = 1;",
        declarationSource: "export declare const database: 1;",
      });
      ctx.slot("resolve.alias").add({
        id: input.id,
        specifier: input.specifier,
        replacement: module,
        declaration: input.declaration,
      });
    },
  };
  await expect(
    prepareFrameworkBuild(
      { ...createBaseConfig(), plugins: [plugin] },
      { cwd },
    ),
  ).rejects.toThrow(message);
}

async function expectRejectedRawDeclaration(
  declaration: unknown,
  message: string,
): Promise<void> {
  const cwd = await createProject();
  const plugin: Plugin<Record<string, never>> = {
    name: "invalid-declaration-object",
    contributions(ctx) {
      const module = ctx.emit.module({
        id: "database",
        scope: { kind: "server" },
        source: "export const database = 1;",
        declarationSource: "export declare const database: 1;",
      });
      ctx.slot("resolve.alias").add({
        id: "database-alias",
        specifier: "evdb:invalid-declaration-object",
        replacement: module,
        declaration,
      } as never);
    },
  };
  await expect(
    prepareFrameworkBuild(
      { ...createBaseConfig(), plugins: [plugin] },
      { cwd },
    ),
  ).rejects.toThrow(message);
}

async function createProject(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-declarations-"));
  tempDirs.push(cwd);
  await fs.mkdir(path.join(cwd, "src"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>', "utf-8"),
    fs.writeFile(path.join(cwd, "src/main.ts"), "export {};\n", "utf-8"),
  ]);
  return cwd;
}

function createBaseConfig() {
  return {
    output: { client: "dist/client", server: "dist/server" },
    conventions: false as const,
  };
}

function createDeclarationConfig() {
  return {
    ...createBaseConfig(),
    plugins: [createDeclarationPlugin()],
  };
}

function createDeclarationPlugin(): Plugin<Record<string, never>> {
  return {
    name: "discovery-declaration",
    contributions(ctx) {
      const module = ctx.emit.module({
        id: "database",
        scope: { kind: "server" },
        source: [
          "export const database = { id: 1 as number };",
          "export type Database = { id: number };",
        ].join("\n"),
        declarationSource: [
          "export declare const database: { readonly id: number };",
          "export type Database = { id: number };",
        ].join("\n"),
      });
      ctx.slot("resolve.alias").add({
        id: "database-alias",
        specifier: "evdb:database",
        replacement: module,
        declaration: {
          exports: [
            { kind: "value", name: "database" },
            {
              kind: "type",
              name: "Database",
              typeParameters: "none",
            },
          ],
        },
      });
    },
  };
}
