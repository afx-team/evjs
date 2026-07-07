import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AppGraph,
  BuildEntry,
  BuildPlan,
  ClientEntrySlotPlanItem,
  ClientRuntimePluginSlotPlanItem,
  ContributionRuntime,
  ContributionTarget,
  EntryContributionPosition,
  FrameworkSlotName,
  FrameworkSlotPlanItem,
  GeneratedEntryPlan,
  GeneratedFrameworkPlan,
  GeneratedImportEdgePlan,
  GeneratedModulePlan,
  GeneratedScope,
  HtmlTagName,
  HtmlTagPlacement,
  HtmlTagSlotPlanItem,
  PagesAppEntryMetadata,
  ReactComponentPageEntryMetadata,
  ServerAppEntryMetadata,
  ServerMiddlewareNode,
} from "@evjs/shared/manifest";
import type { ResolvedConfig } from "../../config/index.js";
import type {
  ContributionContext,
  EmitApi,
  FrameworkEntryView,
  FrameworkIRView,
  FrameworkPagesAppEntryView,
  FrameworkSlot,
  FrameworkSlotInput,
  GeneratedModuleRef,
  HtmlDocument,
  Plugin,
  PluginContext,
} from "../../plugin/index.js";
import { toPosixPath } from "./utils.js";

export const GENERATED_IR_DIR = ".ev";
export const GENERATED_IR_MANIFEST = "manifest.json";
export const GENERATED_IR_TYPES = "types.d.ts";

const generatedModuleRefSymbol = Symbol.for("evjs.generated.module.ref");
const FRAMEWORK_SLOT_NAMES = [
  "client.entry",
  "client.runtime.plugin",
  "server.request.middleware",
  "html.tag",
  "resolve.alias",
  "resolve.external",
] as const satisfies readonly FrameworkSlotName[];
const ENTRY_POSITIONS = [
  "polyfill",
  "before-main-imports",
  "after-main-imports",
  "before-main",
  "after-main",
] as const satisfies readonly EntryContributionPosition[];
const CONTRIBUTION_RUNTIMES = [
  "client",
  "server",
  "all",
] as const satisfies readonly ContributionRuntime[];
const CLIENT_ENTRY_MODES = ["import", "replace"] as const;
const HTML_TAG_NAMES = [
  "meta",
  "link",
  "script",
  "style",
] as const satisfies readonly HtmlTagName[];
const HTML_TAG_PLACEMENTS = [
  "head-prepend",
  "head-append",
  "body-prepend",
  "body-append",
] as const satisfies readonly HtmlTagPlacement[];
const SUPPORTED_GENERATED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".less",
  ".json",
]);

type GeneratedSource =
  | string
  | ((helpers: {
      importOf(ref: GeneratedModuleRef): string;
      importFile(file: string): string;
    }) => string);

interface InternalGeneratedModule {
  key: string;
  id: string;
  pluginName: string;
  scope: GeneratedScope;
  source: GeneratedSource;
  resolvedSource?: string;
  extension: string;
  file: string;
  absoluteFile: string;
  specifier: string;
}

interface InternalImportEdgeInput {
  from: string;
  kind: GeneratedImportEdgePlan["kind"];
  specifier?: string;
}

interface InternalGeneratedModuleRef {
  readonly __evGeneratedModuleRef: typeof generatedModuleRefSymbol;
  readonly key: string;
}

interface MaterializeFrameworkIROptions<TBundlerCfg> {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  config: ResolvedConfig<TBundlerCfg>;
  graph: AppGraph;
  plan: BuildPlan;
  plugins: Plugin<TBundlerCfg>[];
  pluginContext: PluginContext<TBundlerCfg>;
  write?: boolean;
}

export async function materializeFrameworkIR<TBundlerCfg>(
  options: MaterializeFrameworkIROptions<TBundlerCfg>,
): Promise<BuildPlan> {
  const plan = cloneJson(options.plan);
  const collector = new ContributionCollector({
    cwd: options.cwd,
    mode: options.mode,
    command: options.command,
    config: options.config,
    graph: options.graph,
    plan,
    pluginContext: options.pluginContext,
  });

  for (const plugin of options.plugins) {
    if (!plugin.contributions) continue;
    await collector.run(plugin);
  }
  collector.resolveModuleSources();

  const generated = collector.toGeneratedPlan();
  applyResolveContributions(plan, generated);
  ensureServerEntryForMiddlewareContributions(plan, generated);
  plan.generated = generated;
  const entries = createGeneratedEntryPlans(plan, generated);
  generated.entries = entries;
  rewritePlanEntriesToGeneratedFiles(plan, entries);

  if (options.write ?? true) {
    await writeGeneratedIR(
      options.cwd,
      options.graph,
      plan,
      collector.modules,
      generated,
    );
  }

  return plan;
}

export function applyHtmlTagContributions(
  doc: HtmlDocument,
  html: { kind: "app"; appId: string } | { kind: "page"; pageId: string },
  plan: BuildPlan,
): void {
  const tags = getSlotItems<HtmlTagSlotPlanItem>(plan, "html.tag").filter(
    (item) => targetMatchesHtml(item.target, html),
  );
  for (const tag of tags) {
    const element = doc.createElement(tag.tag);
    for (const [name, value] of Object.entries(tag.attrs ?? {})) {
      if (value === false) continue;
      element.setAttribute(name, value === true ? "" : value);
    }
    if (tag.children !== undefined) {
      element.textContent = tag.children;
    }

    const parent = tag.placement.startsWith("head") ? doc.head : doc.body;
    if (!parent) continue;
    if (tag.placement.endsWith("prepend")) {
      parent.prepend(element);
    } else {
      parent.append(element);
    }
  }
}

class ContributionCollector<TBundlerCfg> {
  readonly modules: InternalGeneratedModule[] = [];
  private readonly slots: FrameworkSlotPlanItem[] = [];
  private readonly importEdges: GeneratedImportEdgePlan[] = [];
  private readonly seenImportEdges = new Set<string>();
  private readonly refs = new Map<string, InternalGeneratedModule>();
  private readonly seenKeys = new Map<string, string>();

  constructor(
    private readonly options: {
      cwd: string;
      mode: "development" | "production";
      command: "dev" | "build";
      config: ResolvedConfig<TBundlerCfg>;
      graph: AppGraph;
      plan: BuildPlan;
      pluginContext: PluginContext<TBundlerCfg>;
    },
  ) {}

  async run(plugin: Plugin<TBundlerCfg>): Promise<void> {
    const emit = this.createEmitApi(plugin.name);
    const context: ContributionContext<TBundlerCfg> = {
      ...this.options.pluginContext,
      mode: this.options.mode,
      command: this.options.command,
      cwd: this.options.cwd,
      config: this.options.config,
      framework: createFrameworkIRView(this.options.graph, this.options.plan),
      emit,
      slot: <K extends FrameworkSlotName>(name: K) =>
        this.createSlot(plugin.name, name),
    };
    await plugin.contributions?.(context);
  }

  resolveModuleSources(): void {
    for (const module of this.modules) {
      module.resolvedSource =
        typeof module.source === "function"
          ? module.source({
              importOf: (ref) =>
                this.importOf(ref, {
                  from: module.key,
                  kind: "module-import",
                  specifier: this.importSpecifierFromGeneratedFile(
                    ref,
                    module.absoluteFile,
                  ),
                }),
              importFile: (file) =>
                toGeneratedImportSpecifier(
                  this.options.cwd,
                  module.absoluteFile,
                  file,
                ),
            })
          : module.source;
    }
  }

  toGeneratedPlan(): GeneratedFrameworkPlan {
    return {
      version: 1,
      rootDir: `./${GENERATED_IR_DIR}`,
      entriesDir: `./${GENERATED_IR_DIR}/entries`,
      frameworkDir: `./${GENERATED_IR_DIR}/framework`,
      pluginsDir: `./${GENERATED_IR_DIR}/plugins`,
      frameworkFiles: createGeneratedFrameworkFiles(),
      modules: this.modules.map(toGeneratedModulePlan),
      slots: this.slots,
      importEdges: this.importEdges,
      entries: [],
    };
  }

  private createEmitApi(pluginName: string): EmitApi {
    return {
      module: (input) => {
        const id = validateContributionId(input.id, pluginName);
        return this.emitGeneratedModule(pluginName, {
          id,
          scope: input.scope,
          source: input.source,
          extension: input.extension ?? ".ts",
          keyKind: "generated module",
        });
      },
      data: (input) => {
        const source = `${JSON.stringify(input.value, null, 2)}\n`;
        const id = validateContributionId(input.id, pluginName);
        return this.emitGeneratedModule(pluginName, {
          id,
          scope: input.scope,
          source,
          extension: ".json",
          keyKind: "generated data",
        });
      },
      entryFacade: (input) => {
        const id = validateContributionId(input.id, pluginName);
        const entry = findFrameworkEntry(
          this.options.plan,
          input.entry,
          pluginName,
          id,
        );
        if (entry.environment !== "client") {
          throw new Error(
            `[evjs] Plugin "${pluginName}" entry facade "${id}" can only target client entries.`,
          );
        }
        return this.emitGeneratedModule(pluginName, {
          id,
          scope: input.scope ?? generatedScopeForEntry(entry),
          source: ({ importFile }) =>
            createOriginalClientEntryFacadeSource(entry, importFile),
          extension: ".ts",
          keyKind: "entry facade",
        });
      },
      importOf: (ref) =>
        this.importOf(ref, {
          from: pluginName,
          kind: "plugin-import-helper",
        }),
    };
  }

  private emitGeneratedModule(
    pluginName: string,
    input: {
      id: string;
      scope: GeneratedScope;
      source: GeneratedSource;
      extension: string;
      keyKind: string;
    },
  ): GeneratedModuleRef {
    if (!SUPPORTED_GENERATED_EXTENSIONS.has(input.extension)) {
      throw new Error(
        `[evjs] Plugin "${pluginName}" generated module "${input.id}" uses unsupported extension "${input.extension}".`,
      );
    }
    validateGeneratedScope(pluginName, input.id, input.scope);
    const key = this.reserveKey(pluginName, input.id, input.keyKind);
    const module = this.createGeneratedModule({
      pluginName,
      id: input.id,
      key,
      scope: input.scope,
      source: input.source,
      extension: input.extension,
    });
    this.modules.push(module);
    this.refs.set(key, module);
    return {
      __evGeneratedModuleRef: generatedModuleRefSymbol,
      key,
    } as unknown as GeneratedModuleRef;
  }

  private createSlot<K extends FrameworkSlotName>(
    pluginName: string,
    name: K,
  ): FrameworkSlot<K> {
    validateEnum(
      name,
      FRAMEWORK_SLOT_NAMES,
      `Plugin "${pluginName}" slot name`,
    );
    return {
      add: (input) => {
        assertRecord(input, `Plugin "${pluginName}" ${name} contribution`);
        const normalized = this.normalizeSlotInput(pluginName, name, input);
        this.slots.push(normalized);
      },
    };
  }

  private normalizeSlotInput<K extends FrameworkSlotName>(
    pluginName: string,
    name: K,
    input: FrameworkSlotInput<K>,
  ): FrameworkSlotPlanItem {
    const base = this.createSlotBase(pluginName, input);
    switch (name) {
      case "client.entry": {
        const item = input as FrameworkSlotInput<"client.entry">;
        assertGeneratedModuleOrString(pluginName, item.id, item.module);
        return {
          ...base,
          slot: name,
          module: this.resolveModuleValue(
            item.module,
            {
              from: base.key,
              kind: "slot-module",
            },
            "file",
          ),
          position: validateEnum(
            item.position,
            ENTRY_POSITIONS,
            `${base.key}.position`,
          ),
          runtime: validateEnum(
            item.runtime ?? "client",
            CONTRIBUTION_RUNTIMES,
            `${base.key}.runtime`,
          ),
          mode: validateEnum(
            item.mode ?? "import",
            CLIENT_ENTRY_MODES,
            `${base.key}.mode`,
          ),
          ...(item.target
            ? { target: validateContributionTarget(item.target) }
            : {}),
        };
      }
      case "client.runtime.plugin": {
        const item = input as FrameworkSlotInput<"client.runtime.plugin">;
        assertGeneratedModuleOrString(pluginName, item.id, item.module);
        return {
          ...base,
          slot: name,
          module: this.resolveModuleValue(
            item.module,
            {
              from: base.key,
              kind: "slot-module",
            },
            "file",
          ),
          ...(item.exportKeys
            ? {
                exportKeys: validateStringArray(
                  item.exportKeys,
                  `${base.key}.exportKeys`,
                ),
              }
            : {}),
          ...(item.target
            ? { target: validateContributionTarget(item.target) }
            : {}),
        };
      }
      case "server.request.middleware": {
        const item = input as FrameworkSlotInput<"server.request.middleware">;
        assertGeneratedModuleOrString(pluginName, item.id, item.module);
        return {
          ...base,
          slot: name,
          module: this.resolveModuleValue(
            item.module,
            {
              from: base.key,
              kind: "slot-module",
            },
            "file",
          ),
        };
      }
      case "html.tag": {
        const item = input as FrameworkSlotInput<"html.tag">;
        return {
          ...base,
          slot: name,
          tag: validateEnum(item.tag, HTML_TAG_NAMES, `${base.key}.tag`),
          placement: validateEnum(
            item.placement,
            HTML_TAG_PLACEMENTS,
            `${base.key}.placement`,
          ),
          ...(item.attrs
            ? { attrs: validateHtmlAttrs(item.attrs, `${base.key}.attrs`) }
            : {}),
          ...(item.children !== undefined
            ? {
                children: validateRawString(
                  item.children,
                  `${base.key}.children`,
                ),
              }
            : {}),
          ...(item.target
            ? { target: validateContributionTarget(item.target) }
            : {}),
        };
      }
      case "resolve.alias": {
        const item = input as FrameworkSlotInput<"resolve.alias">;
        assertTrimmedString(item.specifier, `${base.key}.specifier`);
        assertGeneratedModuleOrString(pluginName, item.id, item.replacement);
        return {
          ...base,
          slot: name,
          specifier: item.specifier,
          replacement: this.resolveModuleValue(
            item.replacement,
            {
              from: base.key,
              kind: "resolve-alias",
            },
            "file",
          ),
        };
      }
      case "resolve.external": {
        const item = input as FrameworkSlotInput<"resolve.external">;
        assertTrimmedString(item.specifier, `${base.key}.specifier`);
        if (item.source !== undefined) {
          assertTrimmedString(item.source, `${base.key}.source`);
        }
        return {
          ...base,
          slot: name,
          specifier: item.specifier,
          ...(item.source ? { source: item.source } : {}),
          runtime: validateEnum(
            item.runtime ?? "all",
            CONTRIBUTION_RUNTIMES,
            `${base.key}.runtime`,
          ),
        };
      }
    }
  }

  private createSlotBase(
    pluginName: string,
    input: { id: string },
  ): Pick<FrameworkSlotPlanItem, "key" | "id" | "pluginName"> {
    const id = validateContributionId(input.id, pluginName);
    return {
      key: this.reserveKey(pluginName, id, "slot contribution"),
      id,
      pluginName,
    };
  }

  private createGeneratedModule(input: {
    pluginName: string;
    id: string;
    key: string;
    scope: GeneratedScope;
    source: GeneratedSource;
    extension: string;
  }): InternalGeneratedModule {
    const pluginSlug = sanitizePluginPathSegment(input.pluginName);
    const idSlug = sanitizePathSegment(input.id);
    let specifierSlug = idSlug;
    let file = `./${GENERATED_IR_DIR}/plugins/${pluginSlug}/${specifierSlug}${input.extension}`;
    let specifier = `evjs:generated/${pluginSlug}/${specifierSlug}`;
    if (
      this.modules.some(
        (module) => module.file === file || module.specifier === specifier,
      )
    ) {
      specifierSlug = `${idSlug}-${shortHash(input.key)}`;
      file = `./${GENERATED_IR_DIR}/plugins/${pluginSlug}/${specifierSlug}${input.extension}`;
      specifier = `evjs:generated/${pluginSlug}/${specifierSlug}`;
    }
    return {
      key: input.key,
      id: input.id,
      pluginName: input.pluginName,
      scope: input.scope,
      source: input.source,
      extension: input.extension,
      file,
      absoluteFile: path.resolve(this.options.cwd, file),
      specifier,
    };
  }

  private reserveKey(pluginName: string, id: string, label: string): string {
    const key = `${pluginName}:${id}`;
    const existing = this.seenKeys.get(key);
    if (existing) {
      throw new Error(
        `[evjs] Duplicate contribution id "${id}" in plugin "${pluginName}". It was already used by ${existing}.`,
      );
    }
    this.seenKeys.set(key, label);
    return key;
  }

  private resolveModuleValue(
    value: GeneratedModuleRef | string,
    edge?: InternalImportEdgeInput,
    mode: "specifier" | "file" = "specifier",
  ): string {
    if (typeof value === "string") return value;
    const module = this.resolveGeneratedModule(value);
    const specifier = mode === "file" ? module.file : module.specifier;
    this.addImportEdge(module, edge ? { ...edge, specifier } : undefined);
    return specifier;
  }

  private importOf(
    ref: GeneratedModuleRef,
    edge?: InternalImportEdgeInput,
  ): string {
    const module = this.resolveGeneratedModule(ref);
    const specifier = edge?.specifier ?? module.specifier;
    this.addImportEdge(module, edge ? { ...edge, specifier } : undefined);
    return specifier;
  }

  private importSpecifierFromGeneratedFile(
    ref: GeneratedModuleRef,
    fromFile: string,
  ): string {
    return toGeneratedImportSpecifier(
      this.options.cwd,
      fromFile,
      this.resolveGeneratedModule(ref).file,
    );
  }

  private resolveGeneratedModule(
    ref: GeneratedModuleRef,
  ): InternalGeneratedModule {
    const module = this.refs.get(assertGeneratedModuleRef(ref).key);
    if (!module) {
      throw new Error(
        "[evjs] Generated module ref does not belong to this build.",
      );
    }
    return module;
  }

  private addImportEdge(
    module: InternalGeneratedModule,
    edge: InternalImportEdgeInput | undefined,
  ): void {
    if (!edge) return;
    const specifier = edge.specifier ?? module.specifier;
    const edgeKey = `${edge.from}\0${module.key}\0${edge.kind}\0${specifier}`;
    if (!this.seenImportEdges.has(edgeKey)) {
      this.seenImportEdges.add(edgeKey);
      this.importEdges.push({
        from: edge.from,
        to: module.key,
        kind: edge.kind,
        specifier,
      });
    }
  }
}

async function writeGeneratedIR(
  cwd: string,
  graph: AppGraph,
  plan: BuildPlan,
  modules: InternalGeneratedModule[],
  generated: GeneratedFrameworkPlan,
): Promise<void> {
  const rootDir = path.resolve(cwd, GENERATED_IR_DIR);
  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.mkdir(rootDir, { recursive: true });

  const modulesByKey = new Map(modules.map((module) => [module.key, module]));
  await Promise.all([
    writeGeneratedTypes(rootDir),
    ...writeGeneratedFrameworkFiles(cwd, graph, plan),
    ...modules.map((module) =>
      writeGeneratedModule(cwd, rootDir, module, modulesByKey),
    ),
    ...generated.entries.map((entry) =>
      writeGeneratedEntry(cwd, rootDir, plan, entry),
    ),
  ]);

  await fs.writeFile(
    path.join(rootDir, GENERATED_IR_MANIFEST),
    `${JSON.stringify(createManifestView(plan, graph), null, 2)}\n`,
    "utf-8",
  );
}

function writeGeneratedFrameworkFiles(
  cwd: string,
  graph: AppGraph,
  plan: BuildPlan,
): Promise<void>[] {
  return [
    writeJsonFile(
      path.resolve(cwd, `./${GENERATED_IR_DIR}/framework/app-graph.json`),
      {
        version: 1,
        generatedBy: "evjs",
        graph,
      },
    ),
    writeJsonFile(
      path.resolve(cwd, `./${GENERATED_IR_DIR}/framework/build-plan.json`),
      {
        version: 1,
        generatedBy: "evjs",
        plan,
      },
    ),
  ];
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function writeGeneratedTypes(rootDir: string): Promise<void> {
  await fs.writeFile(
    path.join(rootDir, GENERATED_IR_TYPES),
    [
      "/* This file is generated by evjs. Do not edit it directly. */",
      'declare module "evjs:generated/*";',
      'declare module "*.css";',
      'declare module "*.less";',
      'declare module "*.scss";',
      'declare module "*.sass";',
      'declare module "*.json";',
      'declare module "*.svg";',
      'declare module "*.png";',
      'declare module "*.jpg";',
      'declare module "*.jpeg";',
      'declare module "*.gif";',
      'declare module "*.webp";',
      'declare module "*.avif";',
      "",
    ].join("\n"),
    "utf-8",
  );
}

async function writeGeneratedModule(
  cwd: string,
  rootDir: string,
  module: InternalGeneratedModule,
  modulesByKey: Map<string, InternalGeneratedModule>,
): Promise<void> {
  const resolvedSource =
    module.resolvedSource ??
    (typeof module.source === "function"
      ? module.source({
          importOf(ref) {
            const key = assertGeneratedModuleRef(ref).key;
            const referenced = modulesByKey.get(key);
            if (!referenced) {
              throw new Error(
                "[evjs] Generated module ref does not belong to this build.",
              );
            }
            return toGeneratedImportSpecifier(
              cwd,
              module.absoluteFile,
              referenced.file,
            );
          },
          importFile(file) {
            return toGeneratedImportSpecifier(cwd, module.absoluteFile, file);
          },
        })
      : module.source);
  await fs.mkdir(path.dirname(module.absoluteFile), { recursive: true });
  await fs.writeFile(
    module.absoluteFile,
    withGeneratedHeader(resolvedSource, module.extension, {
      fromFile: module.absoluteFile,
      rootDir,
    }),
    "utf-8",
  );
}

async function writeGeneratedEntry(
  cwd: string,
  rootDir: string,
  plan: BuildPlan,
  entry: GeneratedEntryPlan,
): Promise<void> {
  const buildEntry = plan.entries.find((item) => item.name === entry.name);
  if (!buildEntry) return;
  const absoluteFile = path.resolve(cwd, entry.file);
  await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
  await fs.writeFile(
    absoluteFile,
    withGeneratedHeader(
      createEntrySource(cwd, buildEntry, entry, plan),
      ".ts",
      {
        fromFile: absoluteFile,
        rootDir,
      },
    ),
    "utf-8",
  );
}

function createManifestView(plan: BuildPlan, graph: AppGraph): unknown {
  return {
    version: 1,
    buildId: plan.buildId,
    mode: plan.mode,
    distDir: plan.distDir,
    output: plan.output,
    resolve: plan.resolve,
    graph,
    generated: plan.generated,
    entries: plan.entries,
    html: plan.html,
    server: plan.server,
    runtime: plan.runtime,
  };
}

function createFrameworkIRView(
  graph: AppGraph,
  plan: BuildPlan,
): FrameworkIRView {
  const entries = plan.entries.map(createFrameworkEntryView);
  return deepFreeze({
    apps: Object.values(graph.apps).map(cloneJson),
    pages: Object.values(graph.pages).map(cloneJson),
    routes: graph.routes.map(cloneJson),
    serverRoutes: graph.serverRoutes.map(cloneJson),
    serverFunctions: graph.serverFunctions.map(cloneJson),
    entries,
    getEntry(name) {
      return entries.find((entry) => entry.name === name);
    },
    getPagesAppEntry() {
      return entries.find(isFrameworkPagesAppEntryView);
    },
  });
}

function createFrameworkEntryView(entry: BuildEntry): FrameworkEntryView {
  return cloneJson(entry) as FrameworkEntryView;
}

function isFrameworkPagesAppEntryView(
  entry: FrameworkEntryView,
): entry is FrameworkPagesAppEntryView {
  return entry.metadata?.type === "pages-app";
}

function findFrameworkEntry(
  plan: BuildPlan,
  view: FrameworkEntryView,
  pluginName: string,
  id: string,
): BuildEntry {
  const entry = plan.entries.find((item) => item.name === view.name);
  if (entry) return entry;
  throw new Error(
    `[evjs] Plugin "${pluginName}" entry facade "${id}" references unknown framework entry "${view.name}".`,
  );
}

function generatedScopeForEntry(entry: BuildEntry): GeneratedScope {
  if (entry.owner?.pageId) {
    return { kind: "page", pageId: entry.owner.pageId };
  }
  if (entry.environment === "server") {
    return { kind: "server" };
  }
  return { kind: "app" };
}

function withGeneratedHeader(
  source: string,
  extension: string,
  options?: { fromFile: string; rootDir: string },
): string {
  if (extension === ".json") return `${source.trimEnd()}\n`;
  if (extension === ".css" || extension === ".less") {
    return [
      "/* This file is generated by evjs. Do not edit it directly. */",
      source.trimEnd(),
      "",
    ].join("\n");
  }
  const typesReference = options
    ? `/// <reference path="${toGeneratedImportSpecifier(
        options.rootDir,
        options.fromFile,
        path.join(options.rootDir, GENERATED_IR_TYPES),
      )}" />`
    : "";
  return [
    "/* eslint-disable */",
    typesReference,
    "// This file is generated by evjs. Do not edit it directly.",
    source.trimEnd(),
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function applyResolveContributions(
  plan: BuildPlan,
  generated: GeneratedFrameworkPlan,
): void {
  const generatedFileBySpecifier = new Map(
    generated.modules.map((module) => [module.specifier, module.file]),
  );
  const alias = {
    ...(plan.resolve?.alias ?? {}),
    ...Object.fromEntries(
      generated.modules.map((module) => [module.specifier, module.file]),
    ),
  };
  const external = { ...(plan.resolve?.external ?? {}) };

  for (const item of generated.slots) {
    if (item.slot === "resolve.alias") {
      alias[item.specifier] =
        generatedFileBySpecifier.get(item.replacement) ?? item.replacement;
    }
    if (item.slot === "resolve.external") {
      external[item.specifier] = {
        ...(item.source ? { source: item.source } : {}),
        runtime: item.runtime,
      };
    }
  }

  plan.resolve = {
    ...(Object.keys(alias).length > 0 ? { alias } : {}),
    ...(Object.keys(external).length > 0 ? { external } : {}),
  };
}

function ensureServerEntryForMiddlewareContributions(
  plan: BuildPlan,
  generated: GeneratedFrameworkPlan,
): void {
  if (
    getSlotItemsFromGenerated(generated, "server.request.middleware").length ===
    0
  ) {
    return;
  }
  if (plan.entries.some((entry) => entry.metadata?.type === "server-app"))
    return;

  plan.entries.push({
    name: "server",
    import: "./.ev/entries/server.ts",
    environment: "server",
    runtime: "node",
    kind: "server-runtime",
    metadata: {
      type: "server-app",
      routes: [],
    },
  });
  plan.server = {
    ...plan.server,
    entry: "./.ev/entries/server.ts",
  };
}

function createGeneratedEntryPlans(
  plan: BuildPlan,
  generated: GeneratedFrameworkPlan,
): GeneratedEntryPlan[] {
  const used = new Set<string>();
  return plan.entries
    .filter((entry) => shouldGenerateEntry(entry, plan, generated))
    .map((entry) => {
      const fileName = uniqueEntryFileName(entry.name, used);
      return {
        name: entry.name,
        file: `./${GENERATED_IR_DIR}/entries/${fileName}`,
        originalImport: entry.import,
        kind: entry.kind,
        environment: entry.environment,
      };
    });
}

function shouldGenerateEntry(
  entry: BuildEntry,
  plan: BuildPlan,
  generated: GeneratedFrameworkPlan,
): boolean {
  if (entry.metadata) return true;
  if (
    entry.kind === "page-server" ||
    entry.kind === "rsc-page" ||
    entry.kind === "ppr-shell" ||
    entry.kind === "ppr-region"
  ) {
    return true;
  }
  if (entry.environment === "client") {
    return (
      getMatchingClientEntrySlots(plan, entry).length > 0 ||
      getMatchingRuntimePluginSlots(plan, entry).length > 0 ||
      getSlotItemsFromGenerated<ClientEntrySlotPlanItem>(
        generated,
        "client.entry",
      ).some((slot) => targetMatchesEntry(slot.target, entry))
    );
  }
  return false;
}

function rewritePlanEntriesToGeneratedFiles(
  plan: BuildPlan,
  entries: GeneratedEntryPlan[],
): void {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  plan.entries = plan.entries.map((entry) => {
    const generated = byName.get(entry.name);
    return generated ? { ...entry, import: generated.file } : entry;
  });

  const serverEntry = plan.entries.find(
    (entry) => entry.kind === "server-runtime",
  );
  plan.server = {
    ...plan.server,
    ...(serverEntry ? { entry: serverEntry.import } : {}),
    ...(plan.server.renderers
      ? {
          renderers: plan.server.renderers.map((renderer) => {
            const generated = byName.get(renderer.name);
            return generated
              ? { ...renderer, import: generated.file }
              : renderer;
          }),
        }
      : {}),
  };
}

function createEntrySource(
  cwd: string,
  entry: BuildEntry,
  generatedEntry: GeneratedEntryPlan,
  plan: BuildPlan,
): string {
  const fromFile = path.resolve(cwd, generatedEntry.file);
  if (entry.metadata?.type === "pages-app") {
    return createClientEntrySource({
      cwd,
      entry,
      fromFile,
      plan,
      mainSource: createPagesAppMainSource(cwd, fromFile, entry.metadata),
    });
  }
  if (entry.metadata?.type === "react-component-page") {
    return createClientEntrySource({
      cwd,
      entry,
      fromFile,
      plan,
      mainSource: createReactComponentPageMainSource(
        cwd,
        fromFile,
        entry.metadata,
      ),
    });
  }
  if (entry.metadata?.type === "server-app") {
    return createServerAppEntrySource(cwd, fromFile, entry.metadata, plan);
  }
  if (entry.environment === "client") {
    const original = toGeneratedImportSpecifier(
      cwd,
      fromFile,
      generatedEntry.originalImport,
    );
    return createClientEntrySource({
      cwd,
      entry,
      fromFile,
      plan,
      mainSource: [`import ${JSON.stringify(original)};`],
    });
  }
  if (entry.kind === "rsc-page") {
    const mod = toGeneratedImportSpecifier(
      cwd,
      fromFile,
      generatedEntry.originalImport,
    );
    return [
      `import Component from ${JSON.stringify(mod)};`,
      `import { createRscPageFlightRenderer } from "@evjs/ev/_internal/client/rsc-page-context";`,
      "",
      "export const renderFlight = createRscPageFlightRenderer(Component);",
      "export default Component;",
    ].join("\n");
  }
  const mod = toGeneratedImportSpecifier(
    cwd,
    fromFile,
    generatedEntry.originalImport,
  );
  return [
    `export { PageProvider } from "@evjs/ev/_internal/client/page-context";`,
    `export { default } from ${JSON.stringify(mod)};`,
    `export * from ${JSON.stringify(mod)};`,
  ].join("\n");
}

function createClientEntrySource(options: {
  cwd: string;
  entry: BuildEntry;
  fromFile: string;
  plan: BuildPlan;
  mainSource: string[];
}): string {
  const entrySlots = getMatchingClientEntrySlots(options.plan, options.entry);
  const runtimePlugins = getMatchingRuntimePluginSlots(
    options.plan,
    options.entry,
  );
  const replacement = entrySlots.filter((slot) => slot.mode === "replace");
  if (replacement.length > 1) {
    throw new Error(
      `[evjs] Entry "${options.entry.name}" has multiple replacement client.entry contributions: ${replacement
        .map((slot) => slot.key)
        .join(", ")}.`,
    );
  }

  const importsFor = (position: ClientEntrySlotPlanItem["position"]) =>
    entrySlots
      .filter((slot) => slot.position === position && slot.mode !== "replace")
      .map((slot) =>
        importSlotModule(options.cwd, options.fromFile, slot.module, position),
      );
  const runtimeImports = runtimePlugins.flatMap((slot, index) => [
    `import * as __evRuntimePlugin${index} from ${JSON.stringify(
      toGeneratedImportSpecifier(options.cwd, options.fromFile, slot.module),
    )};`,
  ]);
  const runtimeRegistry =
    runtimePlugins.length > 0
      ? [
          `const __evRuntimePlugins = [${runtimePlugins
            .map((slot, index) => {
              const properties = [
                `key: ${JSON.stringify(slot.key)}`,
                `module: __evRuntimePlugin${index}`,
                slot.exportKeys
                  ? `exportKeys: ${JSON.stringify(slot.exportKeys)}`
                  : "",
              ].filter(Boolean);
              return `{ ${properties.join(", ")} }`;
            })
            .join(", ")}];`,
          "void __evRuntimePlugins;",
        ]
      : [];

  const replacementSlot = replacement[0];
  const mainSource = replacementSlot
    ? [
        `export * from ${JSON.stringify(
          toGeneratedImportSpecifier(
            options.cwd,
            options.fromFile,
            replacementSlot.module,
          ),
        )};`,
      ]
    : options.mainSource;

  return [
    ...importsFor("polyfill"),
    ...importsFor("before-main-imports"),
    ...runtimeImports,
    ...runtimeRegistry,
    ...importsFor("before-main"),
    ...mainSource,
    ...importsFor("after-main-imports"),
    ...importsFor("after-main"),
  ]
    .filter(Boolean)
    .join("\n");
}

function createOriginalClientEntryFacadeSource(
  entry: BuildEntry,
  importFile: (file: string) => string,
): string {
  if (entry.metadata?.type === "pages-app") {
    return createPagesAppMainSourceFromImportFile(
      entry.metadata,
      importFile,
    ).join("\n");
  }
  if (entry.metadata?.type === "react-component-page") {
    return createReactComponentPageMainSourceFromImportFile(
      entry.metadata,
      importFile,
    ).join("\n");
  }
  return `import ${JSON.stringify(importFile(entry.import))};`;
}

function createPagesAppMainSource(
  cwd: string,
  fromFile: string,
  metadata: PagesAppEntryMetadata,
): string[] {
  return createPagesAppMainSourceFromImportFile(metadata, (file) =>
    toGeneratedImportSpecifier(cwd, fromFile, file),
  );
}

function createPagesAppMainSourceFromImportFile(
  metadata: PagesAppEntryMetadata,
  importFile: (file: string) => string,
): string[] {
  const imports = [
    `import { createPagesApp } from "@evjs/ev/_internal/client";`,
    metadata.rootModule
      ? `import * as rootModule from ${JSON.stringify(
          importFile(metadata.rootModule),
        )};`
      : "",
    ...metadata.routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(
          importFile(route.module),
        )};`,
    ),
    ...metadata.routes.flatMap((route, index) => [
      route.errorModule
        ? `import * as routeErrorModule${index} from ${JSON.stringify(
            importFile(route.errorModule),
          )};`
        : "",
      route.notFoundModule
        ? `import * as routeNotFoundModule${index} from ${JSON.stringify(
            importFile(route.notFoundModule),
          )};`
        : "",
    ]),
  ].filter(Boolean);

  const routeDefinitions = metadata.routes.map((route, index) => {
    const properties = [
      route.id ? `id: ${JSON.stringify(route.id)}` : "",
      `path: ${JSON.stringify(route.path)}`,
      route.parentId ? `parentId: ${JSON.stringify(route.parentId)}` : "",
      route.kind ? `kind: ${JSON.stringify(route.kind)}` : "",
      `module: ${createRouteModuleExpression(route, index)}`,
    ].filter(Boolean);
    return `{ ${properties.join(", ")} }`;
  });

  return [
    ...imports,
    "",
    "const { app } = createPagesApp({",
    metadata.rootModule ? "  rootModule," : "",
    `  routes: [${routeDefinitions.join(", ")}],`,
    "});",
    `app.render(${JSON.stringify(metadata.mount)});`,
    "export { app };",
    "export default app;",
  ].filter(Boolean);
}

function createReactComponentPageMainSource(
  cwd: string,
  fromFile: string,
  metadata: ReactComponentPageEntryMetadata,
): string[] {
  return createReactComponentPageMainSourceFromImportFile(metadata, (file) =>
    toGeneratedImportSpecifier(cwd, fromFile, file),
  );
}

function createReactComponentPageMainSourceFromImportFile(
  metadata: ReactComponentPageEntryMetadata,
  importFile: (file: string) => string,
): string[] {
  const component = importFile(metadata.component);
  const entryOptions = {
    mount: metadata.mount,
    hydrate: metadata.hydrate,
    render: metadata.render,
    ...(metadata.route ? { route: metadata.route } : {}),
  };
  return [
    `import Component from ${JSON.stringify(component)};`,
    `import { createGeneratedReactPageEntry } from "@evjs/ev/_internal/client/react-page";`,
    "",
    `const mod = createGeneratedReactPageEntry(Component, ${JSON.stringify(entryOptions)}, import.meta.url);`,
    "export default mod;",
  ];
}

function createServerAppEntrySource(
  cwd: string,
  fromFile: string,
  metadata: ServerAppEntryMetadata,
  plan: BuildPlan,
): string {
  const contributionMiddlewares = getSlotItems<FrameworkSlotPlanItem>(
    plan,
    "server.request.middleware",
  ).map((item, index) => ({
    id: item.id,
    module: (item as { module: string }).module,
    scope: "global" as const,
    importName: `contributedMiddleware${index}`,
  }));
  const middlewares = metadata.middlewares ?? [];
  const middlewareModules = collectMiddlewareModules(
    middlewares,
    metadata.routes,
  );
  const middlewareImportNames = new Map(
    middlewareModules.map((middleware, index) => [
      middleware.module,
      `middleware${index}`,
    ]),
  );
  const serverFunctionModules = collectServerFunctionModules(
    metadata.serverFunctions,
  );

  const imports = [
    `import { createApp, createRoute } from "@evjs/ev/_internal/server";`,
    `import { createReactFrameworkServer } from "@evjs/ev/_internal/server/react";`,
    ...contributionMiddlewares.map(
      (middleware) =>
        `import ${middleware.importName} from ${JSON.stringify(
          toGeneratedImportSpecifier(cwd, fromFile, middleware.module),
        )};`,
    ),
    ...middlewareModules.map(
      (middleware, index) =>
        `import middleware${index} from ${JSON.stringify(
          toGeneratedImportSpecifier(cwd, fromFile, middleware.module),
        )};`,
    ),
    ...serverFunctionModules.map(
      (module) =>
        `import ${JSON.stringify(toGeneratedImportSpecifier(cwd, fromFile, module))};`,
    ),
    ...metadata.routes.map(
      (route, index) =>
        `import * as routeModule${index} from ${JSON.stringify(
          toGeneratedImportSpecifier(cwd, fromFile, route.module),
        )};`,
    ),
  ];
  const routeDefinitions = metadata.routes.flatMap((route, index) => {
    const properties = [
      ...(toMiddlewares(route.middlewares).length > 0
        ? [
            `middlewares: [${toMiddlewareReferences(
              route.middlewares,
              middlewareImportNames,
            ).join(", ")}]`,
          ]
        : []),
      ...toMethods(route).map(
        (method) => `${method}: routeModule${index}.${method}`,
      ),
    ];
    if (properties.length === 0) {
      return [`const routeDefinition${index} = {};`];
    }
    return [
      `const routeDefinition${index} = {`,
      ...properties.map((property) => `  ${property},`),
      "};",
    ];
  });
  const routeEntries = metadata.routes.map(
    (route, index) =>
      `createRoute(${JSON.stringify(route.path)}, routeDefinition${index})`,
  );
  const middlewareReferences = [
    ...contributionMiddlewares.map((middleware) => middleware.importName),
    ...toMiddlewareReferences(middlewares, middlewareImportNames),
  ];

  return [
    ...imports,
    "",
    ...routeDefinitions,
    "",
    "const framework = createReactFrameworkServer();",
    `const middlewares = [${middlewareReferences.join(", ")}];`,
    `const routes = [${routeEntries.join(", ")}];`,
    "const app = createApp({ middlewares, routes, ...(framework ? { framework } : {}) });",
    "export const fetch = app.fetch;",
    "export default { fetch };",
  ].join("\n");
}

function createRouteModuleExpression(
  route: PagesAppEntryMetadata["routes"][number],
  index: number,
): string {
  const properties = [];
  if (route.errorModule) {
    properties.push(
      `errorComponent: routeErrorModule${index}.default ?? routeErrorModule${index}.errorComponent`,
    );
  }
  if (route.notFoundModule) {
    properties.push(
      `notFoundComponent: routeNotFoundModule${index}.default ?? routeNotFoundModule${index}.notFoundComponent`,
    );
  }
  if (properties.length === 0) return `routeModule${index}`;
  return `{ ${properties.join(", ")}, ...routeModule${index} }`;
}

function getMatchingClientEntrySlots(
  plan: BuildPlan,
  entry: BuildEntry,
): ClientEntrySlotPlanItem[] {
  return getSlotItems<ClientEntrySlotPlanItem>(plan, "client.entry").filter(
    (slot) =>
      slot.runtime !== "server" && targetMatchesEntry(slot.target, entry),
  );
}

function getMatchingRuntimePluginSlots(
  plan: BuildPlan,
  entry: BuildEntry,
): ClientRuntimePluginSlotPlanItem[] {
  return getSlotItems<ClientRuntimePluginSlotPlanItem>(
    plan,
    "client.runtime.plugin",
  ).filter((slot) => targetMatchesEntry(slot.target, entry));
}

function getSlotItems<T extends FrameworkSlotPlanItem>(
  plan: BuildPlan,
  slot: FrameworkSlotName,
): T[] {
  return getSlotItemsFromGenerated<T>(plan.generated, slot);
}

function getSlotItemsFromGenerated<T extends FrameworkSlotPlanItem>(
  generated: GeneratedFrameworkPlan | undefined,
  slot: FrameworkSlotName,
): T[] {
  return (generated?.slots ?? []).filter(
    (item): item is T => item.slot === slot,
  );
}

function targetMatchesEntry(
  target: ContributionTarget | undefined,
  entry: BuildEntry,
): boolean {
  if (!target) return true;
  if (target.kind === "app") {
    if (!entry.owner?.appId) return false;
    return target.appId === undefined || target.appId === entry.owner.appId;
  }
  return target.pageId === entry.owner?.pageId;
}

function targetMatchesHtml(
  target: ContributionTarget | undefined,
  html: { kind: "app"; appId: string } | { kind: "page"; pageId: string },
): boolean {
  if (!target) return true;
  if (target.kind === "app") {
    return (
      html.kind === "app" && (!target.appId || target.appId === html.appId)
    );
  }
  return html.kind === "page" && target.pageId === html.pageId;
}

function importSlotModule(
  cwd: string,
  fromFile: string,
  specifier: string,
  position: ClientEntrySlotPlanItem["position"],
): string {
  const mod = toGeneratedImportSpecifier(cwd, fromFile, specifier);
  if (position === "after-main") {
    return `void import(${JSON.stringify(mod)});`;
  }
  return `import ${JSON.stringify(mod)};`;
}

function toGeneratedImportSpecifier(
  cwd: string,
  fromFile: string,
  specifier: string,
): string {
  if (!isPathLikeSpecifier(cwd, specifier)) return specifier;
  const absolute = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(cwd, specifier);
  if (absolute.includes("!")) {
    return pathToFileURL(absolute).href.replace(/!/g, "%21");
  }
  let relative = toPosixPath(path.relative(path.dirname(fromFile), absolute));
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return stripScriptImportExtension(relative);
}

function stripScriptImportExtension(specifier: string): string {
  if (/\.d\.[cm]?ts$/.test(specifier)) return specifier;
  return specifier.replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

function isPathLikeSpecifier(cwd: string, specifier: string): boolean {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) return true;
  if (!specifier.includes("/") || specifier.startsWith("@")) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)) return false;
  return existsSync(path.resolve(cwd, specifier));
}

function uniqueEntryFileName(name: string, used: Set<string>): string {
  const base = sanitizePathSegment(name);
  let fileName = `${base}.ts`;
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  fileName = `${base}-${shortHash(name)}.ts`;
  used.add(fileName);
  return fileName;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "generated";
}

function sanitizePluginPathSegment(value: string): string {
  const normalized = value
    .replace(/^@evjs\/plugin-/, "")
    .replace(/^@/, "")
    .replace(/\/plugin-/g, "/")
    .replace(/^plugin-/, "");
  const segments = normalized
    .replace(/:/g, "/")
    .split(/[\\/]+/)
    .map(sanitizePathSegment)
    .filter(Boolean);
  return segments.join("/") || "generated";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function validateContributionId(id: string, pluginName: string): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      `[evjs] Plugin "${pluginName}" contribution id must be a non-empty string.`,
    );
  }
  if (id !== id.trim()) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" contribution id "${id}" must not contain leading or trailing whitespace.`,
    );
  }
  return id;
}

function validateGeneratedScope(
  pluginName: string,
  id: string,
  scope: GeneratedScope,
): void {
  if (!scope || typeof scope !== "object") {
    throw new Error(
      `[evjs] Plugin "${pluginName}" generated module "${id}" must declare a valid scope.`,
    );
  }
  if (scope.kind === "app" || scope.kind === "server") return;
  if (
    scope.kind === "page" &&
    typeof scope.pageId === "string" &&
    scope.pageId.trim()
  ) {
    return;
  }
  throw new Error(
    `[evjs] Plugin "${pluginName}" generated module "${id}" has an invalid scope.`,
  );
}

function validateContributionTarget(
  target: ContributionTarget,
): ContributionTarget {
  if (target.kind === "app") {
    if (target.appId !== undefined)
      assertTrimmedString(target.appId, "target.appId");
    return target.appId === undefined ? { kind: "app" } : { ...target };
  }
  if (target.kind === "page") {
    assertTrimmedString(target.pageId, "target.pageId");
    return { ...target };
  }
  throw new Error('[evjs] target.kind must be "app" or "page".');
}

function assertGeneratedModuleOrString(
  pluginName: string,
  id: string,
  value: GeneratedModuleRef | string,
): void {
  if (typeof value === "string") {
    assertTrimmedString(value, `${pluginName}:${id}.module`);
    return;
  }
  assertGeneratedModuleRef(value);
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  throw new Error(
    `[evjs] ${label} must be one of: ${allowed.map((item) => `"${item}"`).join(", ")}.`,
  );
}

function validateString(value: unknown, label: string): string {
  assertTrimmedString(value as string, label);
  return value as string;
}

function validateRawString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`[evjs] ${label} must be a string.`);
  }
  return value;
}

function validateStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${label} must be an array of strings.`);
  }
  return value.map((item, index) => validateString(item, `${label}[${index}]`));
}

function validateHtmlAttrs(
  value: unknown,
  label: string,
): Record<string, string | boolean> {
  assertRecord(value, label);
  const attrs: Record<string, string | boolean> = {};
  for (const [name, attrValue] of Object.entries(value)) {
    assertTrimmedString(name, `${label} attribute name`);
    if (typeof attrValue !== "string" && typeof attrValue !== "boolean") {
      throw new Error(
        `[evjs] ${label}.${name} must be a string or boolean value.`,
      );
    }
    attrs[name] = attrValue;
  }
  return attrs;
}

function assertRecord(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[evjs] ${label} must be an object.`);
  }
}

function assertTrimmedString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[evjs] ${label} must be a non-empty string.`);
  }
  if (value !== value.trim()) {
    throw new Error(
      `[evjs] ${label} must not contain leading or trailing whitespace.`,
    );
  }
}

function assertGeneratedModuleRef(
  ref: GeneratedModuleRef,
): InternalGeneratedModuleRef {
  if (
    ref &&
    typeof ref === "object" &&
    (ref as unknown as InternalGeneratedModuleRef).__evGeneratedModuleRef ===
      generatedModuleRefSymbol
  ) {
    return ref as unknown as InternalGeneratedModuleRef;
  }
  throw new Error(
    "[evjs] Expected a GeneratedModuleRef returned by emit.module() or emit.data().",
  );
}

function toGeneratedModulePlan(
  module: InternalGeneratedModule,
): GeneratedModulePlan {
  return {
    key: module.key,
    id: module.id,
    pluginName: module.pluginName,
    scope: module.scope,
    file: module.file,
    specifier: module.specifier,
    extension: module.extension,
  };
}

function createGeneratedFrameworkFiles(): GeneratedFrameworkPlan["frameworkFiles"] {
  return [
    {
      id: "app-graph",
      file: `./${GENERATED_IR_DIR}/framework/app-graph.json`,
    },
    {
      id: "build-plan",
      file: `./${GENERATED_IR_DIR}/framework/build-plan.json`,
    },
  ];
}

function collectServerFunctionModules(
  value: ServerAppEntryMetadata["serverFunctions"],
): string[] {
  const modules = new Set<string>();
  for (const serverFunction of value ?? []) {
    modules.add(serverFunction.module);
  }
  return [...modules];
}

function collectMiddlewareModules(
  globalMiddlewares: ServerMiddlewareNode[],
  routes: ServerAppEntryMetadata["routes"],
): ServerMiddlewareNode[] {
  const byModule = new Map<string, ServerMiddlewareNode>();
  for (const middleware of globalMiddlewares) {
    byModule.set(middleware.module, middleware);
  }
  for (const route of routes) {
    for (const middleware of toMiddlewares(route.middlewares)) {
      byModule.set(middleware.module, middleware);
    }
  }
  return [...byModule.values()];
}

function toMethods(route: ServerAppEntryMetadata["routes"][number]): string[] {
  return Array.isArray(route.methods) ? route.methods : [];
}

function toMiddlewares(
  value: ServerMiddlewareNode[] | undefined,
): ServerMiddlewareNode[] {
  return Array.isArray(value) ? value : [];
}

function toMiddlewareReferences(
  value: ServerMiddlewareNode[] | undefined,
  importNames: Map<string, string>,
): string[] {
  return toMiddlewares(value)
    .map((middleware) => importNames.get(middleware.module))
    .filter((value): value is string => Boolean(value));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
