import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectFrameworkBuild,
  prepareFrameworkBuild,
} from "../src/_internal/build/commands.js";
import type { Plugin } from "../src/plugin/index.js";

interface TsserverResponse<TBody = unknown> {
  readonly type: "response";
  readonly command: string;
  readonly request_seq: number;
  readonly success: boolean;
  readonly message?: string;
  readonly body?: TBody;
}

interface PendingRequest {
  readonly command: string;
  readonly resolve: (response: TsserverResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

interface ProtocolPosition {
  readonly line: number;
  readonly offset: number;
}

interface QuickInfoBody {
  readonly displayString: string;
}

interface DefinitionBody {
  readonly definitions?: ReadonlyArray<{ readonly file: string }>;
}

interface DiagnosticBody {
  readonly code: number;
  readonly text: string;
}

interface ProjectInfoBody {
  readonly fileNames?: readonly string[];
}

const tempDirs: string[] = [];
const tsserverClients: TsserverClient[] = [];
const typescriptBin = process.env.EVJS_TEST_TYPESCRIPT_BIN
  ? path.resolve(process.env.EVJS_TEST_TYPESCRIPT_BIN)
  : createRequire(import.meta.url).resolve("typescript/bin/tsc");
const tsserverBin = process.env.EVJS_TEST_TSSERVER_BIN
  ? path.resolve(process.env.EVJS_TEST_TSSERVER_BIN)
  : path.resolve(path.dirname(typescriptBin), "../lib/tsserver.js");

afterEach(async () => {
  await Promise.all(
    tsserverClients.splice(0).map((client) => client.dispose()),
  );
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("generated contribution tsserver discovery", () => {
  it("refreshes exact alias types across deterministic add, update, and remove reloads", async () => {
    const cwd = await createProject();
    const consumerFile = path.join(cwd, "src/consumer.ts");
    const discoveryFile = path.join(cwd, "src/evjs-env.d.ts");
    const typesFile = path.join(cwd, ".ev/types.d.ts");
    const manifestFile = path.join(cwd, ".ev/manifest.json");
    const generatedFile = path.join(
      cwd,
      ".ev/plugins/tsserver-declaration/database.ts",
    );
    const declarationFile = path.join(
      cwd,
      "src/.ev/types/tsserver-declaration/database.d.ts",
    );
    const firstConsumerSource = createConsumerSource(1);
    await fs.writeFile(consumerFile, firstConsumerSource, "utf-8");

    await inspectFrameworkBuild(createDeclarationConfig(1), {
      command: "build",
      cwd,
    });
    await expect(fs.access(path.join(cwd, ".ev"))).rejects.toThrow();
    await expect(fs.access(discoveryFile)).rejects.toThrow();

    const initial = await prepareFrameworkBuild(createBaseConfig(), { cwd });
    await initial.dispose();

    const client = new TsserverClient(tsserverBin);
    tsserverClients.push(client);
    await openProject(client, consumerFile, cwd);
    expect(await semanticDiagnosticCodes(client, consumerFile)).toContain(2307);

    const added = await prepareFrameworkBuild(createDeclarationConfig(1), {
      cwd,
    });
    await added.dispose();
    await reloadProject(client, consumerFile, cwd);

    expect(await semanticDiagnosticCodes(client, consumerFile)).toEqual([]);
    await expectResolvedVersion(client, consumerFile, firstConsumerSource, 1);
    await expectProjectFiles(client, consumerFile, [
      discoveryFile,
      typesFile,
      declarationFile,
    ]);
    expect(await projectFiles(client, consumerFile)).not.toContain(
      generatedFile,
    );

    const oldTimestamp = new Date("2000-01-01T00:00:00.000Z");
    await Promise.all(
      [discoveryFile, typesFile, generatedFile, declarationFile].map((file) =>
        fs.utimes(file, oldTimestamp, oldTimestamp),
      ),
    );
    const unchanged = await prepareFrameworkBuild(createDeclarationConfig(1), {
      cwd,
    });
    await unchanged.dispose();
    for (const file of [
      discoveryFile,
      typesFile,
      generatedFile,
      declarationFile,
    ]) {
      expect((await fs.stat(file)).mtime.getTime()).toBe(
        oldTimestamp.getTime(),
      );
    }

    const secondConsumerSource = createConsumerSource(2);
    await fs.writeFile(consumerFile, secondConsumerSource, "utf-8");
    const updated = await prepareFrameworkBuild(createDeclarationConfig(2), {
      cwd,
    });
    await updated.dispose();
    expect((await fs.stat(discoveryFile)).mtime.getTime()).toBe(
      oldTimestamp.getTime(),
    );
    expect((await fs.stat(typesFile)).mtime.getTime()).not.toBe(
      oldTimestamp.getTime(),
    );
    expect((await fs.stat(generatedFile)).mtime.getTime()).not.toBe(
      oldTimestamp.getTime(),
    );
    expect((await fs.stat(declarationFile)).mtime.getTime()).not.toBe(
      oldTimestamp.getTime(),
    );

    await reloadProject(client, consumerFile, cwd);
    expect(await semanticDiagnosticCodes(client, consumerFile)).toEqual([]);
    await expectResolvedVersion(client, consumerFile, secondConsumerSource, 2);
    const schemaVersionQuickInfo = await quickInfo(
      client,
      consumerFile,
      positionOf(secondConsumerSource, "schemaVersion;", 0),
    );
    expect(schemaVersionQuickInfo.displayString).toContain(
      "const schemaVersion: 2",
    );
    expect(await fs.readFile(typesFile, "utf-8")).toContain(
      "export const schemaVersion:",
    );

    const removed = await prepareFrameworkBuild(createBaseConfig(), { cwd });
    await removed.dispose();
    await expect(fs.access(discoveryFile)).rejects.toThrow();
    await expect(fs.access(generatedFile)).rejects.toThrow();
    await expect(fs.access(declarationFile)).rejects.toThrow();
    await reloadProject(client, consumerFile, cwd);
    expect(await semanticDiagnosticCodes(client, consumerFile)).toContain(2307);
    const removedProject = await projectFiles(client, consumerFile);
    expect(removedProject).not.toContain(discoveryFile);
    expect(removedProject).not.toContain(typesFile);
    expect(removedProject).not.toContain(generatedFile);
    expect(removedProject).not.toContain(declarationFile);

    const typesAfterRemoval = await fs.readFile(typesFile, "utf-8");
    const manifestAfterRemoval = await fs.readFile(manifestFile, "utf-8");
    await Promise.all(
      [typesFile, manifestFile].map((file) =>
        fs.utimes(file, oldTimestamp, oldTimestamp),
      ),
    );
    await inspectFrameworkBuild(createDeclarationConfig(2), {
      command: "build",
      cwd,
    });
    await expect(fs.access(discoveryFile)).rejects.toThrow();
    await expect(fs.access(generatedFile)).rejects.toThrow();
    await expect(fs.readFile(typesFile, "utf-8")).resolves.toBe(
      typesAfterRemoval,
    );
    await expect(fs.readFile(manifestFile, "utf-8")).resolves.toBe(
      manifestAfterRemoval,
    );
    expect((await fs.stat(typesFile)).mtime.getTime()).toBe(
      oldTimestamp.getTime(),
    );
    expect((await fs.stat(manifestFile)).mtime.getTime()).toBe(
      oldTimestamp.getTime(),
    );
  });
});

class TsserverClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private stdoutBuffer = Buffer.alloc(0);
  private stderr = "";
  private nextSequence = 1;
  private disposed = false;

  constructor(serverFile: string) {
    this.child = spawn(
      process.execPath,
      [serverFile, "--disableAutomaticTypingAcquisition"],
      { stdio: "pipe" },
    );
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
      this.consumeMessages();
    });
    this.child.stderr.setEncoding("utf-8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.once("error", (error) => {
      this.rejectPending(error);
    });
    this.child.once("exit", (code, signal) => {
      if (!this.disposed) {
        this.rejectPending(
          new Error(
            `tsserver exited before completing requests (code=${String(code)}, signal=${String(signal)}).${this.stderr ? `\n${this.stderr}` : ""}`,
          ),
        );
      }
    });
  }

  request<TBody>(
    command: string,
    args: Record<string, unknown>,
  ): Promise<TsserverResponse<TBody>> {
    if (this.disposed) {
      return Promise.reject(new Error("tsserver client is disposed."));
    }
    const sequence = this.nextSequence++;
    return new Promise<TsserverResponse<TBody>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(sequence);
        reject(
          new Error(
            `Timed out waiting for tsserver ${command}.${this.stderr ? `\n${this.stderr}` : ""}`,
          ),
        );
      }, 15_000);
      this.pending.set(sequence, {
        command,
        resolve: resolve as (response: TsserverResponse) => void,
        reject,
        timeout,
      });
      this.child.stdin.write(
        `${JSON.stringify({
          seq: sequence,
          type: "request",
          command,
          arguments: args,
        })}\n`,
      );
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectPending(new Error("tsserver client disposed."));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
    });
    this.child.stdin.end();
    let gracefulTimeout: NodeJS.Timeout | undefined;
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => {
        gracefulTimeout = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
    if (gracefulTimeout) clearTimeout(gracefulTimeout);
    if (!graceful && this.child.exitCode === null) {
      this.child.kill("SIGKILL");
      await exited;
    }
  }

  private consumeMessages(): void {
    while (this.stdoutBuffer.length > 0) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.stdoutBuffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = /Content-Length: ([0-9]+)/iu.exec(header)?.[1];
      if (!contentLength) {
        this.rejectPending(
          new Error(`Malformed tsserver response header: ${header}`),
        );
        return;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + Number(contentLength);
      if (this.stdoutBuffer.length < bodyEnd) return;

      const body = this.stdoutBuffer
        .subarray(bodyStart, bodyEnd)
        .toString("utf-8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd);
      this.dispatchMessage(JSON.parse(body) as Record<string, unknown>);
    }
  }

  private dispatchMessage(message: Record<string, unknown>): void {
    if (message.type !== "response") return;
    const requestSequence = message.request_seq;
    if (typeof requestSequence !== "number") return;
    const pending = this.pending.get(requestSequence);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(requestSequence);
    const response = message as unknown as TsserverResponse;
    if (!response.success) {
      pending.reject(
        new Error(
          `tsserver ${pending.command} failed: ${response.message ?? "unknown error"}.${this.stderr ? `\n${this.stderr}` : ""}`,
        ),
      );
      return;
    }
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function openProject(
  client: TsserverClient,
  file: string,
  projectRootPath: string,
): Promise<void> {
  await client.request("open", { file, projectRootPath });
}

async function reloadProject(
  client: TsserverClient,
  file: string,
  projectRootPath: string,
): Promise<void> {
  await client.request("close", { file });
  await client.request("reloadProjects", {});
  await openProject(client, file, projectRootPath);
}

async function semanticDiagnosticCodes(
  client: TsserverClient,
  file: string,
): Promise<number[]> {
  const response = await client.request<DiagnosticBody[]>(
    "semanticDiagnosticsSync",
    { file },
  );
  return (response.body ?? []).map((diagnostic) => diagnostic.code);
}

async function quickInfo(
  client: TsserverClient,
  file: string,
  position: ProtocolPosition,
): Promise<QuickInfoBody> {
  const response = await client.request<QuickInfoBody>("quickinfo", {
    file,
    ...position,
  });
  if (!response.body) throw new Error("tsserver quickinfo returned no body.");
  return response.body;
}

async function expectResolvedVersion(
  client: TsserverClient,
  file: string,
  source: string,
  version: 1 | 2,
): Promise<void> {
  const databasePosition = positionOf(source, "database.version", 0);
  const databaseQuickInfo = await quickInfo(client, file, databasePosition);
  expect(databaseQuickInfo.displayString).toContain(`version: ${version}`);

  const databaseTypePosition = positionOf(source, "= Database", 0, 2);
  const databaseTypeQuickInfo = await quickInfo(
    client,
    file,
    databaseTypePosition,
  );
  expect(databaseTypeQuickInfo.displayString).toContain(`version: ${version}`);

  const definition = await client.request<DefinitionBody>(
    "definitionAndBoundSpan",
    { file, ...databasePosition },
  );
  const definitionFiles =
    definition.body?.definitions?.map((item) => item.file) ?? [];
  expect(
    definitionFiles.some((definitionFile) => {
      const normalized = definitionFile.replaceAll("\\", "/");
      return (
        normalized.endsWith("/.ev/types.d.ts") ||
        normalized.includes("/src/.ev/types/tsserver-declaration/")
      );
    }),
  ).toBe(true);
}

async function expectProjectFiles(
  client: TsserverClient,
  file: string,
  expectedFiles: readonly string[],
): Promise<void> {
  const actualFiles = await projectFiles(client, file);
  for (const expectedFile of expectedFiles) {
    expect(actualFiles).toContain(expectedFile);
  }
}

async function projectFiles(
  client: TsserverClient,
  file: string,
): Promise<string[]> {
  const response = await client.request<ProjectInfoBody>("projectInfo", {
    file,
    needFileNameList: true,
  });
  return [...(response.body?.fileNames ?? [])].map((item) =>
    path.normalize(item),
  );
}

function positionOf(
  source: string,
  needle: string,
  occurrence: number,
  offsetWithinNeedle = 0,
): ProtocolPosition {
  let index = -1;
  for (let current = 0; current <= occurrence; current++) {
    index = source.indexOf(needle, index + 1);
    if (index === -1) {
      throw new Error(
        `Unable to find occurrence ${occurrence} of ${JSON.stringify(needle)}.`,
      );
    }
  }
  const prefix = source.slice(0, index + offsetWithinNeedle);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    offset: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function createConsumerSource(version: 1 | 2): string {
  return [
    version === 1
      ? 'import { database, type Database } from "evdb:database";'
      : 'import { database, schemaVersion, type Database } from "evdb:database";',
    "export const selectedVersion = database.version;",
    ...(version === 2
      ? ["export const selectedSchemaVersion = schemaVersion;"]
      : []),
    "export type SelectedDatabase = Database;",
    "",
  ].join("\n");
}

async function createProject(): Promise<string> {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-tsserver-"));
  tempDirs.push(created);
  const cwd = await fs.realpath(created);
  await fs.mkdir(path.join(cwd, "src"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>', "utf-8"),
    fs.writeFile(path.join(cwd, "src/main.ts"), "export {};\n", "utf-8"),
    fs.writeFile(
      path.join(cwd, "tsconfig.json"),
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
    ),
  ]);
  return cwd;
}

function createBaseConfig() {
  return {
    output: { client: "dist/client", server: "dist/server" },
    conventions: false as const,
  };
}

function createDeclarationConfig(version: 1 | 2) {
  return {
    ...createBaseConfig(),
    plugins: [createDeclarationPlugin(version)],
  };
}

function createDeclarationPlugin(
  version: 1 | 2,
): Plugin<Record<string, never>> {
  return {
    name: "tsserver-declaration",
    contributions(ctx) {
      const module = ctx.emit.module({
        id: "database",
        scope: { kind: "server" },
        source: [
          `export const database = { version: ${version} as const };`,
          ...(version === 2
            ? ["export const schemaVersion = 2 as const;"]
            : []),
          `export type Database = { version: ${version} };`,
        ].join("\n"),
        declarationSource: [
          `export declare const database: { readonly version: ${version} };`,
          ...(version === 2 ? ["export declare const schemaVersion: 2;"] : []),
          `export type Database = { version: ${version} };`,
        ].join("\n"),
      });
      ctx.slot("resolve.alias").add({
        id: "database-alias",
        specifier: "evdb:database",
        replacement: module,
        declaration: {
          exports: [
            { kind: "value", name: "database" },
            ...(version === 2
              ? [{ kind: "value" as const, name: "schemaVersion" }]
              : []),
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
