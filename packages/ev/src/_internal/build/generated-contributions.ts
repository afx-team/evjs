import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertStaticJsonValue } from "@evjs/shared/_internal/static-json";
import type {
  BuildEntry,
  BuildPlan,
  ClientEntrySlotPlanItem,
  ContributionRuntime,
  ContributionTarget,
  CoreGraph,
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
  PageWrapperSlotPlanItem,
  ServerAppEntryMetadata,
  ServerMiddlewareNode,
} from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../config/index.js";
import {
  attachPluginEmissionScope,
  type PluginEmissionApi,
  type PluginEmissionHook,
} from "../../plugin/emission-scope.js";
import { runPluginHook } from "../../plugin/errors.js";
import type {
  EmitApi,
  FrameworkApplicationEntryView,
  FrameworkApplicationView,
  FrameworkEntryOwner,
  FrameworkEntryView,
  FrameworkIRView,
  FrameworkRouteView,
  FrameworkSlot,
  FrameworkSlotInput,
  GeneratedModuleRef,
  HtmlDocument,
  HtmlDocumentInfo,
  Plugin,
  PluginContext,
  PluginEmitIRContext,
} from "../../plugin/index.js";
import {
  createOriginalClientEntryFacadeSource,
  createPagesAppEntryMainSource,
  createReactComponentPageEntryMainSource,
} from "./generated/client-entry-source.js";
import {
  applyPageWrapperContributions,
  getPageWrapperProjectionError,
} from "./generated/page-wrapper-contribution.js";
import { createReactServerPageEntrySource } from "./generated/react-server-page-source.js";
import {
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "./owned-file-output.js";
import { createPluginConfigSnapshot } from "./plugin-lifecycle.js";
import {
  reserveUniquePortableArtifactPath,
  sanitizePortableArtifactPathSegment,
} from "./portable-artifact-path.js";
import { toPosixPath } from "./utils.js";

export const GENERATED_IR_DIR = ".ev";
export const GENERATED_IR_MANIFEST = "manifest.json";
export const GENERATED_IR_TYPES = "types.d.ts";

const generatedModuleRefSymbol = Symbol.for("evjs.generated.module.ref");
const FRAMEWORK_SLOT_NAMES = [
  "client.entry",
  "page.wrapper",
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
const CLIENT_ENTRY_RUNTIMES = ["client"] as const;
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
type GeneratedIRFileSource = string | Uint8Array;

interface InternalGeneratedModule {
  key: string;
  id: string;
  pluginName: string;
  originHook: PluginEmissionHook;
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

type TargetedSlotPlanItem =
  | ClientEntrySlotPlanItem
  | PageWrapperSlotPlanItem
  | HtmlTagSlotPlanItem;

export interface MaterializeFrameworkIROptions<TBundlerCfg> {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  graph: CoreGraph;
  plan: BuildPlan;
  plugins: Plugin<TBundlerCfg>[];
  pluginContext: PluginContext<TBundlerCfg>;
  write?: boolean;
}

export interface PreparedFrameworkIR {
  plan: BuildPlan;
  /** Build-local resolve.alias provenance. This is not serialized into IR. */
  sourceAliasContributions: PreparedSourceAliasContribution[];
  write(): Promise<void>;
}

export interface PreparedSourceAliasContribution {
  readonly specifier: string;
  readonly replacement: string;
  readonly pluginName: string;
  readonly originHook: PluginEmissionHook;
}

/**
 * Collect deterministic plugin contributions against an immutable view of the
 * same pre-contribution graph and plan, then apply the resolved slots to a
 * cloned BuildPlan. Physical `.ev` files are written only after module refs,
 * targets, and entry identities have been resolved and validated.
 */
export async function materializeFrameworkIR<TBundlerCfg>(
  options: MaterializeFrameworkIROptions<TBundlerCfg>,
): Promise<BuildPlan> {
  const prepared = await prepareFrameworkIR(options);
  if (options.write ?? true) await prepared.write();
  return prepared.plan;
}

export async function prepareFrameworkIR<TBundlerCfg>(
  options: Omit<MaterializeFrameworkIROptions<TBundlerCfg>, "write">,
): Promise<PreparedFrameworkIR> {
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
    if (!plugin.emitIR) continue;
    await collector.run(plugin);
  }
  await collector.resolveModuleSources();
  await collector.validateTargets();

  const generated = collector.toGeneratedPlan();
  applyPageWrapperContributions(plan, options.graph, generated);
  applyResolveContributions(plan, generated);
  ensureServerEntryForMiddlewareContributions(plan, generated);
  assertUniqueBuildEntryNames(plan.entries);
  plan.generated = generated;
  const entries = createGeneratedEntryPlans(plan, generated);
  generated.entries = entries;
  rewritePlanEntriesToGeneratedFiles(plan, entries);
  addGeneratedEntrySourceHashes(options.cwd, plan, entries);

  let written = false;
  return {
    plan,
    sourceAliasContributions: collector.getSourceAliasContributions(),
    async write() {
      if (written) return;
      written = true;
      await writeGeneratedIR(
        options.cwd,
        options.graph,
        plan,
        collector.modules,
        generated,
      );
    },
  };
}

export function applyHtmlTagContributions(
  doc: HtmlDocument,
  html: Pick<HtmlDocumentInfo, "applicationId" | "owner">,
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

/**
 * Build-local linker for generated modules and framework slots. Contribution
 * ids are unique per plugin across modules and slots, refs cannot escape their
 * build, and target validation distinguishes semantic graph nodes from the
 * entries and Documents that were actually materialized for them.
 */
class ContributionCollector<TBundlerCfg> {
  readonly modules: InternalGeneratedModule[] = [];
  private readonly slots: FrameworkSlotPlanItem[] = [];
  private readonly importEdges: GeneratedImportEdgePlan[] = [];
  private readonly seenImportEdges = new Set<string>();
  private readonly refs = new Map<string, InternalGeneratedModule>();
  private readonly seenKeys = new Map<string, string>();
  private readonly usedGeneratedModulePathKeys = new Set<string>();
  private readonly slotOrigins = new WeakMap<
    FrameworkSlotPlanItem,
    PluginEmissionHook
  >();

  constructor(
    private readonly options: {
      cwd: string;
      mode: "development" | "production";
      command: "dev" | "build";
      config: ResolvedFrameworkConfig<TBundlerCfg>;
      graph: CoreGraph;
      plan: BuildPlan;
      pluginContext: PluginContext<TBundlerCfg>;
    },
  ) {}

  async run(plugin: Plugin<TBundlerCfg>): Promise<void> {
    await runPluginHook(plugin.name, "emitIR", () => {
      const emission = this.createEmissionApi(plugin.name, "emitIR");
      const context: PluginEmitIRContext<TBundlerCfg> = {
        ...this.options.pluginContext,
        mode: this.options.mode,
        command: this.options.command,
        cwd: this.options.cwd,
        config: createPluginConfigSnapshot(this.options.config),
        framework: createFrameworkIRView(this.options.graph, this.options.plan),
        ...emission,
      };
      attachPluginEmissionScope(context, (originHook) =>
        this.createEmissionApi(plugin.name, originHook),
      );
      return plugin.emitIR?.(context);
    });
  }

  async resolveModuleSources(): Promise<void> {
    for (const module of this.modules) {
      module.resolvedSource = await runPluginHook(
        module.pluginName,
        module.originHook,
        () => {
          const sourceFactory =
            typeof module.source === "function" ? module.source : undefined;
          const source = sourceFactory
            ? sourceFactory({
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
          if (typeof source !== "string") {
            const expectation = sourceFactory
              ? "source factory must return"
              : "source must be";
            throw new Error(
              `[evjs] Plugin "${module.pluginName}" generated module "${module.id}" ${expectation} a string.`,
            );
          }
          return source;
        },
      );
    }
  }

  async validateTargets(): Promise<void> {
    for (const module of this.modules) {
      await runPluginHook(module.pluginName, module.originHook, () =>
        this.validateModuleTarget(module),
      );
    }

    for (const slot of this.slots) {
      await runPluginHook(
        slot.pluginName,
        this.slotOrigins.get(slot) ?? "emitIR",
        () => this.validateSlotTarget(slot),
      );
    }
    await this.validateClientEntryReplacementConflicts();
  }

  private validateModuleTarget(module: InternalGeneratedModule): void {
    if (
      module.scope.kind === "page" &&
      !Object.hasOwn(this.options.graph.pages, module.scope.pageId)
    ) {
      throw new Error(
        `[evjs] Plugin "${module.pluginName}" generated module "${module.id}" targets unknown page "${module.scope.pageId}".`,
      );
    }
  }

  private validateSlotTarget(slot: FrameworkSlotPlanItem): void {
    if (isTargetedSlotPlanItem(slot) && slot.target) {
      this.validateKnownTarget(slot);
    }
    if (slot.slot === "page.wrapper") {
      const projectionError = getPageWrapperProjectionError(
        this.options.plan,
        this.options.graph,
        slot,
      );
      if (projectionError) throw new Error(projectionError);
    }
    if (!isTargetedSlotPlanItem(slot) || !slot.target) return;
    const target = slot.target;

    if (
      slot.slot === "client.entry" &&
      !this.options.plan.entries.some(
        (entry) =>
          entry.environment === "client" && targetMatchesEntry(target, entry),
      )
    ) {
      if (target.kind === "application") {
        const application = target.applicationId
          ? `application "${target.applicationId}"`
          : "an application";
        throw new Error(
          `[evjs] Plugin "${slot.pluginName}" ${slot.slot} contribution "${slot.id}" targets ${application}, but no client entry matches that target.`,
        );
      }
      const pageId = target.pageId;
      const route = this.options.graph.routes.find(
        (candidate) =>
          candidate.target.kind === "page" &&
          candidate.target.pageId === pageId,
      );
      const sharedOwner = route?.applicationId
        ? ` It is served by shared SPA application "${route.applicationId}".`
        : "";
      throw new Error(
        `[evjs] Plugin "${slot.pluginName}" ${slot.slot} contribution "${slot.id}" targets semantic page "${pageId}", but that page does not own a client entry.${sharedOwner} Target the owning application; page-module and route-runtime facets are not available in this contribution slot.`,
      );
    }

    if (
      slot.slot === "html.tag" &&
      ![
        ...this.options.plan.html.map((document) => document.owner),
        ...(this.options.plan.server.documents ?? []).map((document) => ({
          appId: document.applicationId,
          pageId: document.pageId,
        })),
      ].some((owner) => targetMatchesHtmlOwner(target, owner))
    ) {
      if (target.kind === "application") {
        const application = target.applicationId
          ? `application "${target.applicationId}"`
          : "an application";
        throw new Error(
          `[evjs] Plugin "${slot.pluginName}" html.tag contribution "${slot.id}" targets ${application}, but no Document matches that target.`,
        );
      }
      const pageId = target.pageId;
      const route = this.options.graph.routes.find(
        (candidate) =>
          candidate.target.kind === "page" &&
          candidate.target.pageId === pageId,
      );
      const sharedOwner = route?.applicationId
        ? ` It shares the Document owned by SPA application "${route.applicationId}".`
        : "";
      throw new Error(
        `[evjs] Plugin "${slot.pluginName}" html.tag contribution "${slot.id}" targets semantic page "${pageId}", but that page does not own a Document.${sharedOwner} Target the owning application; route-aware head facets are not available in this contribution slot.`,
      );
    }
  }

  private async validateClientEntryReplacementConflicts(): Promise<void> {
    const replacements = this.slots.filter(
      (slot): slot is ClientEntrySlotPlanItem =>
        slot.slot === "client.entry" && slot.mode === "replace",
    );
    if (replacements.length < 2) return;

    for (const entry of this.options.plan.entries) {
      if (entry.environment !== "client") continue;
      let first: ClientEntrySlotPlanItem | undefined;
      for (const replacement of replacements) {
        if (!targetMatchesEntry(replacement.target, entry)) continue;
        if (!first) {
          first = replacement;
          continue;
        }
        const firstReplacement = first;
        await runPluginHook(
          replacement.pluginName,
          this.slotOrigins.get(replacement) ?? "emitIR",
          () => {
            throw new Error(
              `[evjs] Entry "${entry.name}" has multiple replacement client.entry contributions: ${firstReplacement.key}, ${replacement.key}.`,
            );
          },
        );
      }
    }
  }

  private validateKnownTarget(slot: TargetedSlotPlanItem): void {
    const target = slot.target;
    if (!target) return;
    if (target.kind === "page") {
      if (Object.hasOwn(this.options.graph.pages, target.pageId)) return;
      throw new Error(
        `[evjs] Plugin "${slot.pluginName}" ${slot.slot} contribution "${slot.id}" targets unknown page "${target.pageId}".`,
      );
    }
    if (
      target.applicationId === undefined ||
      Object.hasOwn(this.options.graph.applications, target.applicationId)
    ) {
      return;
    }
    throw new Error(
      `[evjs] Plugin "${slot.pluginName}" ${slot.slot} contribution "${slot.id}" targets unknown application "${target.applicationId}".`,
    );
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
      coreGraphHash: hashStableValue(this.options.graph),
    };
  }

  getSourceAliasContributions(): PreparedSourceAliasContribution[] {
    return this.slots.flatMap((slot) =>
      slot.slot === "resolve.alias"
        ? [
            {
              specifier: slot.specifier,
              replacement: slot.replacement,
              pluginName: slot.pluginName,
              originHook: this.slotOrigins.get(slot) ?? "emitIR",
            },
          ]
        : [],
    );
  }

  private createEmissionApi(
    pluginName: string,
    originHook: PluginEmissionHook,
  ): PluginEmissionApi {
    return {
      emit: this.createEmitApi(pluginName, originHook),
      slot: <K extends FrameworkSlotName>(name: K) =>
        this.createSlot(pluginName, name, originHook),
    };
  }

  private createEmitApi(
    pluginName: string,
    originHook: PluginEmissionHook,
  ): EmitApi {
    return {
      module: (input) => {
        const id = validateContributionId(input.id, pluginName);
        return this.emitGeneratedModule(pluginName, {
          id,
          scope: input.scope,
          source: input.source,
          extension: input.extension ?? ".ts",
          keyKind: "generated module",
          originHook,
        });
      },
      data: (input) => {
        const id = validateContributionId(input.id, pluginName);
        assertStaticJsonValue(
          input.value,
          `Plugin "${pluginName}" generated data "${id}" value`,
        );
        const source = `${JSON.stringify(input.value, null, 2)}\n`;
        return this.emitGeneratedModule(pluginName, {
          id,
          scope: input.scope,
          source,
          extension: ".json",
          keyKind: "generated data",
          originHook,
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
        if (input.autoStart === false && entry.metadata?.type !== "pages-app") {
          throw new Error(
            `[evjs] Plugin "${pluginName}" entry facade "${id}" can disable autoStart only for a generated SPA Application entry.`,
          );
        }
        return this.emitGeneratedModule(pluginName, {
          id,
          scope: input.scope ?? generatedScopeForEntry(entry),
          source: ({ importFile }) =>
            createOriginalClientEntryFacadeSource(entry, importFile, {
              autoStart: input.autoStart,
            }),
          extension: ".ts",
          keyKind: "entry facade",
          originHook,
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
      originHook: PluginEmissionHook;
    },
  ): GeneratedModuleRef {
    if (!SUPPORTED_GENERATED_EXTENSIONS.has(input.extension)) {
      throw new Error(
        `[evjs] Plugin "${pluginName}" generated module "${input.id}" uses unsupported extension "${input.extension}".`,
      );
    }
    const scope = normalizeGeneratedScope(pluginName, input.id, input.scope);
    const key = this.reserveKey(pluginName, input.id, input.keyKind);
    const module = this.createGeneratedModule({
      pluginName,
      id: input.id,
      key,
      scope,
      source: input.source,
      extension: input.extension,
      originHook: input.originHook,
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
    originHook: PluginEmissionHook,
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
        this.slotOrigins.set(normalized, originHook);
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
            CLIENT_ENTRY_RUNTIMES,
            `${base.key}.runtime`,
          ),
          mode: validateEnum(
            item.mode ?? "import",
            CLIENT_ENTRY_MODES,
            `${base.key}.mode`,
          ),
          ...(item.target !== undefined
            ? { target: normalizeContributionTarget(item.target) }
            : {}),
        };
      }
      case "page.wrapper": {
        const item = input as FrameworkSlotInput<"page.wrapper">;
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
          runtime: validateEnum(
            item.runtime ?? "all",
            CONTRIBUTION_RUNTIMES,
            `${base.key}.runtime`,
          ),
          ...(item.target !== undefined
            ? { target: normalizeContributionTarget(item.target) }
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
          ...(item.target !== undefined
            ? { target: normalizeContributionTarget(item.target) }
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
    throw new Error(
      `[evjs] Plugin "${pluginName}" requested unsupported slot "${String(name)}".`,
    );
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
    originHook: PluginEmissionHook;
  }): InternalGeneratedModule {
    const pluginSlug = sanitizePluginPathSegment(input.pluginName);
    const idSlug = sanitizePortableArtifactPathSegment(input.id);
    const specifierPath = reserveUniquePortableArtifactPath(
      this.usedGeneratedModulePathKeys,
      (attempt) =>
        `${pluginSlug}/${collisionSafeArtifactStem(idSlug, input.key, attempt)}`,
      `Plugin "${input.pluginName}" generated module "${input.id}" artifact path`,
    );
    const file = `./${GENERATED_IR_DIR}/plugins/${specifierPath}${input.extension}`;
    const specifier = `evjs:generated/${specifierPath}`;
    return {
      key: input.key,
      id: input.id,
      pluginName: input.pluginName,
      scope: input.scope,
      source: input.source,
      extension: input.extension,
      originHook: input.originHook,
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

function isTargetedSlotPlanItem(
  slot: FrameworkSlotPlanItem,
): slot is TargetedSlotPlanItem {
  return (
    slot.slot === "client.entry" ||
    slot.slot === "page.wrapper" ||
    slot.slot === "html.tag"
  );
}

/**
 * Replace the framework-owned `.ev` tree with one validated IR snapshot. The
 * complete BuildPlan has its own framework snapshot, while the compact manifest
 * links graph, generated artifacts, and final entry projections for inspection.
 */
async function writeGeneratedIR(
  cwd: string,
  graph: CoreGraph,
  plan: BuildPlan,
  modules: InternalGeneratedModule[],
  generated: GeneratedFrameworkPlan,
): Promise<void> {
  const rootDir = path.resolve(cwd, GENERATED_IR_DIR);
  const modulesByKey = new Map(modules.map((module) => [module.key, module]));
  const files = new Map<string, string>();
  addGeneratedIRFile(files, GENERATED_IR_TYPES, createGeneratedTypes());
  addGeneratedIRFile(
    files,
    "framework/core-graph.json",
    createJsonFileSource({
      generatedBy: "evjs",
      graph,
    }),
  );
  addGeneratedIRFile(
    files,
    "framework/build-plan.json",
    createJsonFileSource({
      version: 1,
      generatedBy: "evjs",
      plan,
    }),
  );
  for (const module of modules) {
    addGeneratedIRFile(
      files,
      toGeneratedIRRelativePath(rootDir, module.absoluteFile),
      createGeneratedModuleSource(cwd, rootDir, module, modulesByKey),
    );
  }
  for (const entry of generated.entries) {
    const source = createGeneratedEntrySource(cwd, rootDir, plan, entry);
    if (source === undefined) continue;
    addGeneratedIRFile(
      files,
      toGeneratedIRRelativePath(rootDir, path.resolve(cwd, entry.file)),
      source,
    );
  }
  addGeneratedIRFile(
    files,
    GENERATED_IR_MANIFEST,
    `${JSON.stringify(createManifestView(plan, graph), null, 2)}\n`,
  );

  await reconcileGeneratedIR(rootDir, files);
}

function addGeneratedIRFile(
  files: Map<string, GeneratedIRFileSource>,
  relativeFile: string,
  source: GeneratedIRFileSource,
): void {
  const portableFile = toPosixPath(relativeFile);
  if (files.has(portableFile)) {
    throw new Error(
      `[evjs] Generated framework IR file "${portableFile}" is not unique.`,
    );
  }
  files.set(portableFile, source);
}

function createJsonFileSource(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createGeneratedTypes(): string {
  return [
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
  ].join("\n");
}

function createGeneratedModuleSource(
  cwd: string,
  rootDir: string,
  module: InternalGeneratedModule,
  modulesByKey: Map<string, InternalGeneratedModule>,
): string {
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
  return withGeneratedHeader(resolvedSource, module.extension, {
    fromFile: module.absoluteFile,
    rootDir,
  });
}

function createGeneratedEntrySource(
  cwd: string,
  rootDir: string,
  plan: BuildPlan,
  entry: GeneratedEntryPlan,
): string | undefined {
  const buildEntry = plan.entries.find((item) => item.name === entry.name);
  if (!buildEntry) return undefined;
  const absoluteFile = path.resolve(cwd, entry.file);
  return withGeneratedHeader(
    createEntrySource(cwd, buildEntry, entry, plan),
    ".ts",
    {
      fromFile: absoluteFile,
      rootDir,
    },
  );
}

/**
 * Reconcile a fully rendered IR snapshot without ever deleting the live tree.
 * Byte-identical files retain their inode, so a persistent compiler cannot
 * observe its unchanged entry facades or generated modules disappearing during
 * a metadata-only update. Changed leaves use atomic replacement and the
 * manifest is replaced last as the snapshot's inspection commit marker.
 */
async function reconcileGeneratedIR(
  rootDir: string,
  files: ReadonlyMap<string, GeneratedIRFileSource>,
): Promise<void> {
  await ensureGeneratedIRRoot(rootDir);
  const existing = await collectGeneratedIRFiles(rootDir);
  const manifestSource = files.get(GENERATED_IR_MANIFEST);

  for (const [relativeFile, source] of files) {
    if (relativeFile === GENERATED_IR_MANIFEST) continue;
    await reconcileGeneratedIRFile(rootDir, relativeFile, source);
    existing.delete(relativeFile);
  }

  existing.delete(GENERATED_IR_MANIFEST);
  for (const relativeFile of existing.keys()) {
    await removeOwnedOutputFile(
      rootDir,
      path.join(rootDir, relativeFile),
      "Generated framework IR",
    );
  }
  await removeEmptyGeneratedIRDirectories(rootDir);

  if (manifestSource !== undefined) {
    await reconcileGeneratedIRFile(
      rootDir,
      GENERATED_IR_MANIFEST,
      manifestSource,
    );
  }
}

async function reconcileGeneratedIRFile(
  rootDir: string,
  relativeFile: string,
  source: GeneratedIRFileSource,
): Promise<void> {
  const file = path.join(rootDir, relativeFile);
  try {
    const stats = await fs.lstat(file);
    const current = stats.isFile() ? await fs.readFile(file) : undefined;
    const expected =
      typeof source === "string"
        ? Buffer.from(source)
        : Buffer.from(source.buffer, source.byteOffset, source.byteLength);
    if (current?.equals(expected)) {
      return;
    }
  } catch (error) {
    if (!isMissingGeneratedIRPath(error)) throw error;
  }
  await writeOwnedOutputFile(rootDir, file, source, "Generated framework IR");
}

/**
 * Restore a previously captured `.ev` directory with the same leaf-level
 * reconciliation used for forward commits. Dev rollback therefore preserves
 * unchanged compiler inputs instead of deleting and recreating the live tree.
 */
export async function restoreGeneratedIRSnapshot(
  rootDir: string,
  snapshotDir: string,
): Promise<void> {
  const snapshotFiles = await collectGeneratedIRFiles(snapshotDir);
  const files = new Map<string, Uint8Array>();
  for (const [relativeFile, snapshotFile] of snapshotFiles) {
    files.set(relativeFile, await fs.readFile(snapshotFile));
  }
  await reconcileGeneratedIR(rootDir, files);
}

async function ensureGeneratedIRRoot(rootDir: string): Promise<void> {
  try {
    const stats = await fs.lstat(rootDir);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `[evjs] Generated framework IR root "${rootDir}" must be a directory and must not be a symbolic link.`,
      );
    }
  } catch (error) {
    if (!isMissingGeneratedIRPath(error)) throw error;
    await fs.mkdir(rootDir, { recursive: true });
  }
}

async function collectGeneratedIRFiles(
  rootDir: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const pending = [rootDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absoluteFile = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absoluteFile);
      } else {
        files.set(
          toPosixPath(path.relative(rootDir, absoluteFile)),
          absoluteFile,
        );
      }
    }
  }
  return files;
}

async function removeEmptyGeneratedIRDirectories(
  rootDir: string,
): Promise<void> {
  const directories: string[] = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      directories.push(child);
      pending.push(child);
    }
  }
  directories.sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    try {
      await fs.rmdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }
}

function toGeneratedIRRelativePath(rootDir: string, file: string): string {
  const relativeFile = path.relative(rootDir, file);
  if (
    !relativeFile ||
    path.isAbsolute(relativeFile) ||
    relativeFile === ".." ||
    relativeFile.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      `[evjs] Generated framework IR file "${file}" must stay inside "${rootDir}".`,
    );
  }
  return relativeFile;
}

function isMissingGeneratedIRPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** Compact index for inspecting linked generated artifacts and plan entries. */
function createManifestView(plan: BuildPlan, graph: CoreGraph): unknown {
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

/**
 * Create the cloned, deeply frozen graph/plan projection exposed to plugins.
 * Callers can inspect semantic ownership and materialized entries but cannot
 * mutate framework IR.
 */
export function createFrameworkIRView(
  graph: CoreGraph,
  plan: BuildPlan,
): FrameworkIRView {
  const entries = plan.entries.map(createFrameworkEntryView);
  return deepFreeze({
    applications: createFrameworkApplicationViews(graph),
    pages: Object.values(graph.pages).map(createFrameworkPageView),
    routes: createFrameworkRouteViews(graph),
    documents: Object.values(graph.documents).map(cloneJson),
    serverRoutes: graph.serverRoutes.map(cloneJson),
    serverFunctions: graph.serverFunctions.map(cloneJson),
    entries,
    getEntry(name) {
      return entries.find((entry) => entry.name === name);
    },
    getApplicationEntry(applicationId) {
      const candidates = entries.filter(isFrameworkApplicationEntryView);
      if (applicationId) {
        return candidates.find(
          (entry) => entry.owner?.applicationId === applicationId,
        );
      }
      return candidates.length === 1 ? candidates[0] : undefined;
    },
  });
}

function createFrameworkRouteViews(
  graph: CoreGraph,
): FrameworkIRView["routes"] {
  return graph.routes.map(
    (route): FrameworkRouteView => ({
      id: route.id,
      applicationId: route.applicationId,
      ...(route.parentId !== undefined ? { parentId: route.parentId } : {}),
      pattern: cloneJson(route.pattern),
      target: cloneJson(route.target),
      facets: cloneJson(route.facets),
      provenance: cloneJson(route.provenance),
    }),
  );
}

function createFrameworkApplicationViews(
  graph: CoreGraph,
): FrameworkApplicationView[] {
  return Object.values(graph.applications).map(createCoreApplicationView);
}

function createCoreApplicationView(
  application: CoreGraph["applications"][string],
): FrameworkApplicationView {
  return {
    id: application.id,
    root: application.root,
    routingMode: application.routingMode,
    ...(application.layout ? { layout: application.layout } : {}),
    pageIds: [...application.pageIds],
    routeIds: [...application.routeIds],
    documentIds: [...application.documentIds],
    plugins: cloneJson(application.plugins),
    provenance: cloneJson(application.provenance),
  };
}

function createFrameworkPageView(
  page: CoreGraph["pages"][string],
): FrameworkIRView["pages"][number] {
  return {
    id: page.id,
    applicationId: page.applicationId,
    source: {
      module: page.source.module,
      scope: cloneJson(page.source.scope),
      provider: page.source.provider,
      ...(page.source.config ? { config: page.source.config } : {}),
    },
    plugins: cloneJson(page.plugins),
    render: page.render,
    ...(page.componentModel ? { componentModel: page.componentModel } : {}),
    ...(page.hydrate ? { hydrate: page.hydrate } : {}),
    ...(page.prerender ? { prerender: cloneJson(page.prerender) } : {}),
    ...(page.ppr ? { ppr: cloneJson(page.ppr) } : {}),
    ...(page.metadata ? { metadata: cloneJson(page.metadata) } : {}),
    provenance: cloneJson(page.provenance),
  };
}

function createFrameworkEntryView(entry: BuildEntry): FrameworkEntryView {
  const { owner: buildOwner, ...view } = cloneJson(entry);
  const owner = createFrameworkEntryOwner(buildOwner);
  if (view.kind === "app-client") {
    if (view.metadata?.type !== "pages-app") {
      throw new Error(
        `[evjs] Application client entry "${view.name}" is missing normalized Application metadata.`,
      );
    }
    return {
      ...view,
      kind: "application-client",
      ...(owner ? { owner } : {}),
      metadata: {
        ...view.metadata,
        type: "application",
      },
    };
  }
  return {
    ...view,
    ...(owner ? { owner } : {}),
  } as FrameworkEntryView;
}

function createFrameworkEntryOwner(
  owner: BuildEntry["owner"],
): FrameworkEntryOwner | undefined {
  if (!owner) return undefined;
  return {
    ...(owner.appId ? { applicationId: owner.appId } : {}),
    ...(owner.pageId ? { pageId: owner.pageId } : {}),
    ...(owner.routeId ? { routeId: owner.routeId } : {}),
    ...(owner.regionId ? { regionId: owner.regionId } : {}),
  };
}

function isFrameworkApplicationEntryView(
  entry: FrameworkEntryView,
): entry is FrameworkApplicationEntryView {
  return (
    entry.kind === "application-client" &&
    entry.metadata?.type === "application"
  );
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
  return { kind: "application" };
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

/**
 * Fold generated-module aliases and ordered resolve slots into the plan. Slot
 * order is precedence order, so a later contribution replaces an earlier value
 * for the same specifier.
 */
function applyResolveContributions(
  plan: BuildPlan,
  generated: GeneratedFrameworkPlan,
): void {
  const generatedFileBySpecifier = new Map(
    generated.modules.map((module) => [module.specifier, module.file]),
  );
  const alias = new Map(Object.entries(plan.resolve?.alias ?? {}));
  for (const [specifier, file] of generatedFileBySpecifier) {
    alias.set(specifier, file);
  }
  const external = new Map(Object.entries(plan.resolve?.external ?? {}));

  for (const item of generated.slots) {
    if (item.slot === "resolve.alias") {
      alias.set(
        item.specifier,
        generatedFileBySpecifier.get(item.replacement) ?? item.replacement,
      );
    }
    if (item.slot === "resolve.external") {
      external.set(item.specifier, {
        ...(item.source ? { source: item.source } : {}),
        runtime: item.runtime,
      });
    }
  }

  const aliasRecord = Object.fromEntries(alias);
  const externalRecord = Object.fromEntries(external);
  plan.resolve = {
    ...(alias.size > 0 ? { alias: aliasRecord } : {}),
    ...(external.size > 0 ? { external: externalRecord } : {}),
  };
}

/**
 * A request-middleware slot is itself a server runtime capability. Ensure it
 * has the same single server-runtime entry used by discovered routes,
 * functions, and request-time renderers.
 */
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
  const serverEntries = plan.entries.filter(
    (entry) => entry.kind === "server-runtime",
  );
  if (serverEntries.length > 1) {
    throw new Error(
      `[evjs] Framework plan has multiple server-runtime entries: ${serverEntries
        .map((entry) => `"${entry.name}"`)
        .join(", ")}.`,
    );
  }
  const existing = serverEntries[0];
  if (existing) {
    if (existing.metadata?.type !== "server-app") {
      existing.metadata = {
        type: "server-app",
        routes: [],
      };
    }
    return;
  }

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

function assertUniqueBuildEntryNames(entries: BuildEntry[]): void {
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(
        `[evjs] Framework plan contains duplicate build entry name "${entry.name}" after applying plugin contributions.`,
      );
    }
    names.add(entry.name);
  }
}

/**
 * Select entries that need framework facades while retaining each original
 * import as the source behind its generated `.ev` entry.
 */
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
      getSlotItemsFromGenerated<ClientEntrySlotPlanItem>(
        generated,
        "client.entry",
      ).some((slot) => targetMatchesEntry(slot.target, entry))
    );
  }
  return false;
}

/**
 * Make generated facades the concrete compiler inputs and keep the server
 * runtime and renderer projections synchronized with those rewritten imports.
 */
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

function addGeneratedEntrySourceHashes(
  cwd: string,
  plan: BuildPlan,
  entries: GeneratedEntryPlan[],
): void {
  for (const entry of entries) {
    const buildEntry = plan.entries.find((item) => item.name === entry.name);
    if (!buildEntry) continue;
    entry.sourceHash = hashText(
      createEntrySource(cwd, buildEntry, entry, plan),
    );
  }
}

function createEntrySource(
  cwd: string,
  entry: BuildEntry,
  generatedEntry: GeneratedEntryPlan,
  plan: BuildPlan,
): string {
  const fromFile = path.resolve(cwd, generatedEntry.file);
  function importFile(file: string): string {
    return toGeneratedImportSpecifier(cwd, fromFile, file);
  }

  if (entry.metadata?.type === "pages-app") {
    return createClientEntrySource({
      cwd,
      entry,
      fromFile,
      plan,
      mainSource: createPagesAppEntryMainSource(entry.metadata, importFile),
    });
  }
  if (entry.metadata?.type === "react-component-page") {
    return createClientEntrySource({
      cwd,
      entry,
      fromFile,
      plan,
      mainSource: createReactComponentPageEntryMainSource(
        entry.metadata,
        importFile,
      ),
    });
  }
  if (entry.metadata?.type === "react-server-page") {
    return createReactServerPageEntrySource(
      entry.metadata,
      entry.kind,
      importFile,
    );
  }
  if (entry.metadata?.type === "server-app") {
    return createServerAppEntrySource(cwd, fromFile, entry.metadata, plan);
  }
  if (entry.environment === "client") {
    const original = importFile(generatedEntry.originalImport);
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

/**
 * Compose client-entry slots around the framework facade. Only `after-main`
 * adds runtime sequencing through dynamic import; every other position emits a
 * static ESM dependency. A replacement substitutes the main facade regardless
 * of its declared position.
 */
function createClientEntrySource(options: {
  cwd: string;
  entry: BuildEntry;
  fromFile: string;
  plan: BuildPlan;
  mainSource: string[];
}): string {
  const entrySlots = getMatchingClientEntrySlots(options.plan, options.entry);
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
    ...importsFor("before-main"),
    ...mainSource,
    ...importsFor("after-main-imports"),
    ...importsFor("after-main"),
  ]
    .filter(Boolean)
    .join("\n");
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

function getMatchingClientEntrySlots(
  plan: BuildPlan,
  entry: BuildEntry,
): ClientEntrySlotPlanItem[] {
  return getSlotItems<ClientEntrySlotPlanItem>(plan, "client.entry").filter(
    (slot) => targetMatchesEntry(slot.target, entry),
  );
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
  if (target.kind === "application") {
    if (!entry.owner?.appId) return false;
    return (
      target.applicationId === undefined ||
      target.applicationId === entry.owner.appId
    );
  }
  return target.pageId === entry.owner?.pageId;
}

function targetMatchesHtml(
  target: ContributionTarget | undefined,
  html: Pick<HtmlDocumentInfo, "applicationId" | "owner">,
): boolean {
  if (!target) return true;
  if (target.kind === "application") {
    return (
      target.applicationId === undefined ||
      target.applicationId === html.applicationId
    );
  }
  return html.owner.kind === "page" && target.pageId === html.owner.pageId;
}

function targetMatchesHtmlOwner(
  target: ContributionTarget,
  owner: { appId?: string; pageId?: string },
): boolean {
  if (target.kind === "application") {
    return Boolean(
      owner.appId &&
        (target.applicationId === undefined ||
          target.applicationId === owner.appId),
    );
  }
  return target.pageId === owner.pageId;
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
  const base = sanitizePortableArtifactPathSegment(name);
  return reserveUniquePortableArtifactPath(
    used,
    (attempt) => `${collisionSafeArtifactStem(base, name, attempt)}.ts`,
    `Generated entry "${name}" artifact path`,
  );
}

function collisionSafeArtifactStem(
  base: string,
  identity: string,
  attempt: number,
): string {
  if (attempt === 0) return base;
  const suffix = shortHash(identity);
  return attempt === 1 ? `${base}-${suffix}` : `${base}-${suffix}-${attempt}`;
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
    .map(sanitizePortableArtifactPathSegment)
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

function normalizeGeneratedScope(
  pluginName: string,
  id: string,
  scope: GeneratedScope,
): GeneratedScope {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" generated module "${id}" must declare a valid scope.`,
    );
  }
  const kind = scope.kind;
  if (kind === "application" || kind === "server") {
    return { kind };
  }
  if (kind === "page") {
    const pageId = scope.pageId;
    assertTrimmedString(pageId, "scope.pageId");
    return { kind, pageId };
  }
  throw new Error(
    `[evjs] Plugin "${pluginName}" generated module "${id}" has an invalid scope.`,
  );
}

function normalizeContributionTarget(
  target: ContributionTarget,
): ContributionTarget {
  assertRecord(target, "target");
  const kind = target.kind;
  if (kind === "application") {
    const applicationId = target.applicationId;
    if (applicationId !== undefined) {
      assertTrimmedString(applicationId, "target.applicationId");
    }
    return applicationId === undefined
      ? { kind: "application" }
      : { kind: "application", applicationId };
  }
  if (kind === "page") {
    const pageId = target.pageId;
    assertTrimmedString(pageId, "target.pageId");
    return { kind: "page", pageId };
  }
  throw new Error('[evjs] target.kind must be "application" or "page".');
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

function validateRawString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`[evjs] ${label} must be a string.`);
  }
  return value;
}

function validateHtmlAttrs(
  value: unknown,
  label: string,
): Record<string, string | boolean> {
  assertRecord(value, label);
  const attrs: Array<[string, string | boolean]> = [];
  for (const [name, attrValue] of Object.entries(value)) {
    assertTrimmedString(name, `${label} attribute name`);
    if (typeof attrValue !== "string" && typeof attrValue !== "boolean") {
      throw new Error(
        `[evjs] ${label}.${name} must be a string or boolean value.`,
      );
    }
    attrs.push([name, attrValue]);
  }
  return Object.fromEntries(attrs);
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
  if (module.resolvedSource === undefined) {
    throw new Error(
      `[evjs] Generated module "${module.key}" source must be resolved before creating the generated plan.`,
    );
  }
  return {
    key: module.key,
    id: module.id,
    pluginName: module.pluginName,
    scope: module.scope,
    file: module.file,
    specifier: module.specifier,
    extension: module.extension,
    sourceHash: hashText(module.resolvedSource),
  };
}

function hashStableValue(value: unknown): string {
  return hashText(JSON.stringify(sortStableValue(value)));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortStableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      })
      .map(([key, nested]) => [key, sortStableValue(nested)]),
  );
}

function createGeneratedFrameworkFiles(): GeneratedFrameworkPlan["frameworkFiles"] {
  return [
    {
      id: "core-graph",
      file: `./${GENERATED_IR_DIR}/framework/core-graph.json`,
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
