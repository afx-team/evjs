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
  ServerEntrySlotPlanItem,
  ServerMiddlewareNode,
} from "@evjs/shared/manifest";
import { assertPluginId } from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../config/index.js";
import type {
  EmitApi,
  FrameworkApplicationEntryView,
  FrameworkApplicationView,
  FrameworkEntryOwner,
  FrameworkEntryView,
  FrameworkRouteView,
  FrameworkSlot,
  FrameworkSlotInput,
  FrameworkView,
  GeneratedModuleRef,
  HtmlDocument,
  HtmlDocumentInfo,
  Plugin,
  PluginSetupContext,
} from "../../plugin/index.js";
import {
  type InternalPluginEmitIRContext,
  pluginEmitIRScopeFactory,
  type ScopedPluginEmitIRContext,
} from "../../plugin/internal.js";
import {
  createOriginalClientEntryFacadeSource,
  createPagesAppEntryMainSource,
  createReactComponentPageEntryMainSource,
} from "./generated/client-entry-source.js";
import { applyPageWrapperContributions } from "./generated/page-wrapper-contribution.js";
import { createReactServerPageEntrySource } from "./generated/react-server-page-source.js";
import { createPluginConfigView } from "./plugin-lifecycle.js";
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
  "server.entry",
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
const SERVER_ENTRY_MODES = ["import", "replace"] as const;
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
  pluginId: string;
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
  | ServerEntrySlotPlanItem
  | PageWrapperSlotPlanItem
  | HtmlTagSlotPlanItem;

export interface PrepareFrameworkIROptions<TBundlerCfg> {
  cwd: string;
  mode: "development" | "production";
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  graph: CoreGraph;
  plan: BuildPlan;
  plugins: Plugin<TBundlerCfg>[];
  pluginContext: PluginSetupContext<TBundlerCfg>;
}

interface MaterializeFrameworkIROptions<TBundlerCfg>
  extends PrepareFrameworkIROptions<TBundlerCfg> {
  write?: boolean;
}

export interface GeneratedIRImageFile {
  /** Portable path relative to the canonical `.ev` root. */
  readonly file: string;
  readonly source: string;
}

/**
 * Fully rendered framework IR ready for filesystem publication.
 *
 * `files` intentionally excludes `manifest.json`: publication writes every
 * other leaf first and uses `manifest` as the completion marker.
 */
export interface GeneratedIRImage {
  readonly files: readonly GeneratedIRImageFile[];
  readonly manifest: string;
}

export interface PreparedFrameworkIR {
  readonly plan: BuildPlan;
  readonly image: GeneratedIRImage;
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
  if (options.write ?? true) {
    await publishFrameworkIR(options.cwd, prepared.image);
  }
  return prepared.plan;
}

/**
 * Resolve and validate one complete framework IR image without touching the
 * filesystem. Dev orchestration can retain the returned image until the old
 * immutable session has stopped, then publish it explicitly.
 */
export async function prepareFrameworkIR<TBundlerCfg>(
  options: PrepareFrameworkIROptions<TBundlerCfg>,
): Promise<PreparedFrameworkIR> {
  const plan = cloneJson(options.plan);
  const collector = new ContributionCollector({
    cwd: options.cwd,
    mode: options.mode,
    config: options.config,
    graph: options.graph,
    plan,
    pluginContext: options.pluginContext,
  });

  for (const plugin of options.plugins) {
    if (!plugin.emitIR) continue;
    await collector.run(plugin);
  }
  collector.resolveModuleSources();
  collector.validateTargets();

  const generated = collector.toGeneratedPlan();
  applyPageWrapperContributions(plan, options.graph, generated);
  applyResolveContributions(plan, generated);
  ensureServerEntryForMiddlewareContributions(plan, generated);
  assertUniqueBuildEntryNames(plan.entries);
  plan.generated = generated;
  const bundleCoreJs =
    options.mode === "production" &&
    options.config.target !== undefined &&
    options.config.polyfill?.coreJs === "bundled";
  const entries = createGeneratedEntryPlans(plan, generated, bundleCoreJs);
  generated.entries = entries;
  rewritePlanEntriesToGeneratedFiles(plan, entries);

  const image = renderGeneratedIRImage(
    options.cwd,
    options.graph,
    plan,
    collector.modules,
    generated,
    bundleCoreJs,
  );
  return { plan, image };
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
 * ids are unique per plugin and emission scope across modules and slots, refs
 * cannot escape their build, and target validation distinguishes semantic
 * graph nodes from the entries and Documents materialized for them.
 */
class ContributionCollector<TBundlerCfg> {
  readonly modules: InternalGeneratedModule[] = [];
  private readonly slots: FrameworkSlotPlanItem[] = [];
  private readonly importEdges: GeneratedImportEdgePlan[] = [];
  private readonly seenImportEdges = new Set<string>();
  private readonly refs = new Map<string, InternalGeneratedModule>();
  private readonly seenKeys = new Map<string, string>();
  private readonly usedGeneratedModulePathKeys = new Set<string>();

  constructor(
    private readonly options: {
      cwd: string;
      mode: "development" | "production";
      config: ResolvedFrameworkConfig<TBundlerCfg>;
      graph: CoreGraph;
      plan: BuildPlan;
      pluginContext: PluginSetupContext<TBundlerCfg>;
    },
  ) {}

  async run(plugin: Plugin<TBundlerCfg>): Promise<void> {
    const pluginId = plugin.id;
    assertPluginId(pluginId, "plugin id");
    const emit = this.createEmitApi(pluginId);
    const context = Object.freeze({
      ...this.options.pluginContext,
      mode: this.options.mode,
      cwd: this.options.cwd,
      config: createPluginConfigView(this.options.config),
      framework: createFrameworkView(this.options.graph, this.options.plan),
      emit,
      slot: <K extends FrameworkSlotName>(name: K) =>
        this.createSlot(pluginId, name),
      [pluginEmitIRScopeFactory]: (namespace: string) =>
        this.createScopedEmitContext(pluginId, namespace),
    }) as InternalPluginEmitIRContext<TBundlerCfg>;
    await plugin.emitIR?.(context);
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

  validateTargets(): void {
    for (const module of this.modules) {
      if (
        module.scope.kind === "page" &&
        !Object.hasOwn(this.options.graph.pages, module.scope.pageId)
      ) {
        throw new Error(
          `[evjs] Plugin "${module.pluginId}" generated module "${module.id}" targets unknown page "${module.scope.pageId}".`,
        );
      }
    }

    const serverEntryReplacements = new Map<string, ServerEntrySlotPlanItem>();
    for (const slot of this.slots) {
      if (!isTargetedSlotPlanItem(slot) || !slot.target) continue;
      const target = slot.target;
      this.validateKnownTarget(slot);

      if (slot.slot === "server.entry") {
        const pageId = slot.target.pageId;
        const matches = this.options.plan.entries.filter(
          (entry) =>
            entry.environment === "server" &&
            entry.kind === "page-server" &&
            targetMatchesEntry(target, entry),
        );
        if (matches.length === 0) {
          throw new Error(
            `[evjs] Plugin "${slot.pluginId}" server.entry contribution "${slot.id}" targets page "${pageId}", but no server page entry matches that target.`,
          );
        }
        if (matches.length > 1) {
          throw new Error(
            `[evjs] Plugin "${slot.pluginId}" server.entry contribution "${slot.id}" targets page "${pageId}", but multiple server page entries match that target: ${matches
              .map((entry) => `"${entry.name}"`)
              .join(", ")}.`,
          );
        }
        const entry = matches[0];
        if (slot.mode === "replace") {
          const previous = serverEntryReplacements.get(entry.name);
          if (previous) {
            throw new Error(
              `[evjs] Server page entry "${entry.name}" has multiple replacement server.entry contributions: ${previous.key}, ${slot.key}.`,
            );
          }
          serverEntryReplacements.set(entry.name, slot);
        }
      }

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
            `[evjs] Plugin "${slot.pluginId}" ${slot.slot} contribution "${slot.id}" targets ${application}, but no client entry matches that target.`,
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
          `[evjs] Plugin "${slot.pluginId}" ${slot.slot} contribution "${slot.id}" targets semantic page "${pageId}", but that page does not own a client entry.${sharedOwner} Target the owning application; page-module and route-runtime facets are not available in this contribution slot.`,
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
            `[evjs] Plugin "${slot.pluginId}" html.tag contribution "${slot.id}" targets ${application}, but no Document matches that target.`,
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
          `[evjs] Plugin "${slot.pluginId}" html.tag contribution "${slot.id}" targets semantic page "${pageId}", but that page does not own a Document.${sharedOwner} Target the owning application; route-aware head facets are not available in this contribution slot.`,
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
        `[evjs] Plugin "${slot.pluginId}" ${slot.slot} contribution "${slot.id}" targets unknown page "${target.pageId}".`,
      );
    }
    if (
      target.applicationId === undefined ||
      Object.hasOwn(this.options.graph.applications, target.applicationId)
    ) {
      return;
    }
    throw new Error(
      `[evjs] Plugin "${slot.pluginId}" ${slot.slot} contribution "${slot.id}" targets unknown application "${target.applicationId}".`,
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

  private createScopedEmitContext(
    pluginId: string,
    namespace: string,
  ): ScopedPluginEmitIRContext {
    return Object.freeze({
      emit: this.createEmitApi(pluginId, namespace),
      slot: <K extends FrameworkSlotName>(name: K) =>
        this.createSlot(pluginId, name, namespace),
    });
  }

  private createEmitApi(pluginId: string, namespace?: string): EmitApi {
    const emit: EmitApi = {
      module: (input) => {
        const id = validateContributionId(input.id, pluginId);
        return this.emitGeneratedModule(
          pluginId,
          {
            id,
            scope: input.scope,
            source: input.source,
            extension: input.extension ?? ".ts",
            keyKind: "generated module",
          },
          namespace,
        );
      },
      data: (input) => {
        const id = validateContributionId(input.id, pluginId);
        assertStaticJsonValue(
          input.value,
          `Plugin "${pluginId}" generated data "${id}" value`,
        );
        const source = `${JSON.stringify(input.value, null, 2)}\n`;
        return this.emitGeneratedModule(
          pluginId,
          {
            id,
            scope: input.scope,
            source,
            extension: ".json",
            keyKind: "generated data",
          },
          namespace,
        );
      },
      entryFacade: (input) => {
        const id = validateContributionId(input.id, pluginId);
        const entry = findFrameworkEntry(
          this.options.plan,
          input.entry,
          pluginId,
          id,
        );
        if (entry.environment !== "client") {
          throw new Error(
            `[evjs] Plugin "${pluginId}" entry facade "${id}" can only target client entries.`,
          );
        }
        if (input.autoStart === false && entry.metadata?.type !== "pages-app") {
          throw new Error(
            `[evjs] Plugin "${pluginId}" entry facade "${id}" can disable autoStart only for a generated SPA Application entry.`,
          );
        }
        return this.emitGeneratedModule(
          pluginId,
          {
            id,
            scope: input.scope ?? generatedScopeForEntry(entry),
            source: ({ importFile }) =>
              createOriginalClientEntryFacadeSource(entry, importFile, {
                autoStart: input.autoStart,
                bundleCoreJs:
                  this.options.mode === "production" &&
                  this.options.config.target !== undefined &&
                  this.options.config.polyfill?.coreJs === "bundled",
              }),
            extension: ".ts",
            keyKind: "entry facade",
          },
          namespace,
        );
      },
      importOf: (ref) =>
        this.importOf(ref, {
          from: pluginId,
          kind: "plugin-import-helper",
        }),
    };
    return Object.freeze(emit);
  }

  private emitGeneratedModule(
    pluginId: string,
    input: {
      id: string;
      scope: GeneratedScope;
      source: GeneratedSource;
      extension: string;
      keyKind: string;
    },
    namespace?: string,
  ): GeneratedModuleRef {
    if (!SUPPORTED_GENERATED_EXTENSIONS.has(input.extension)) {
      throw new Error(
        `[evjs] Plugin "${pluginId}" generated module "${input.id}" uses unsupported extension "${input.extension}".`,
      );
    }
    const scope = snapshotGeneratedScope(pluginId, input.id, input.scope);
    const key = this.reserveKey(pluginId, input.id, input.keyKind, namespace);
    const module = this.createGeneratedModule({
      pluginId,
      id: input.id,
      key,
      scope,
      source: input.source,
      extension: input.extension,
    });
    this.modules.push(module);
    this.refs.set(key, module);
    return Object.freeze({
      __evGeneratedModuleRef: generatedModuleRefSymbol,
      key,
    }) as unknown as GeneratedModuleRef;
  }

  private createSlot<K extends FrameworkSlotName>(
    pluginId: string,
    name: K,
    namespace?: string,
  ): FrameworkSlot<K> {
    validateEnum(name, FRAMEWORK_SLOT_NAMES, `Plugin "${pluginId}" slot name`);
    const slot: FrameworkSlot<K> = {
      add: (input) => {
        assertRecord(input, `Plugin "${pluginId}" ${name} contribution`);
        const normalized = this.normalizeSlotInput(
          pluginId,
          name,
          input,
          namespace,
        );
        this.slots.push(normalized);
      },
    };
    return Object.freeze(slot);
  }

  private normalizeSlotInput<K extends FrameworkSlotName>(
    pluginId: string,
    name: K,
    input: FrameworkSlotInput<K>,
    namespace?: string,
  ): FrameworkSlotPlanItem {
    const base = this.createSlotBase(pluginId, input, namespace);
    switch (name) {
      case "client.entry": {
        const item = input as FrameworkSlotInput<"client.entry">;
        assertGeneratedModuleOrString(pluginId, item.id, item.module);
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
          ...(item.target
            ? { target: validateContributionTarget(item.target) }
            : {}),
        };
      }
      case "server.entry": {
        const item = input as FrameworkSlotInput<"server.entry">;
        assertGeneratedModuleOrString(pluginId, item.id, item.module);
        const mode = validateEnum(
          item.mode ?? "import",
          SERVER_ENTRY_MODES,
          `${base.key}.mode`,
        );
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
          position:
            mode === "replace" && item.position === undefined
              ? "before-main"
              : validateEnum(
                  item.position,
                  ENTRY_POSITIONS,
                  `${base.key}.position`,
                ),
          target: validateServerEntryTarget(item.target),
          mode,
        };
      }
      case "page.wrapper": {
        const item = input as FrameworkSlotInput<"page.wrapper">;
        assertGeneratedModuleOrString(pluginId, item.id, item.module);
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
          ...(item.target
            ? { target: validateContributionTarget(item.target) }
            : {}),
        };
      }
      case "server.request.middleware": {
        const item = input as FrameworkSlotInput<"server.request.middleware">;
        assertGeneratedModuleOrString(pluginId, item.id, item.module);
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
        assertGeneratedModuleOrString(pluginId, item.id, item.replacement);
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
      `[evjs] Plugin "${pluginId}" requested unsupported slot "${String(name)}".`,
    );
  }

  private createSlotBase(
    pluginId: string,
    input: { id: string },
    namespace?: string,
  ): Pick<FrameworkSlotPlanItem, "key" | "id" | "pluginId"> {
    const id = validateContributionId(input.id, pluginId);
    return {
      key: this.reserveKey(pluginId, id, "slot contribution", namespace),
      id,
      pluginId,
    };
  }

  private createGeneratedModule(input: {
    pluginId: string;
    id: string;
    key: string;
    scope: GeneratedScope;
    source: GeneratedSource;
    extension: string;
  }): InternalGeneratedModule {
    const pluginSegment = input.pluginId;
    const idSlug = sanitizePortableArtifactPathSegment(input.id);
    const specifierPath = reserveUniquePortableArtifactPath(
      this.usedGeneratedModulePathKeys,
      (attempt) =>
        `${pluginSegment}/${collisionSafeArtifactStem(idSlug, input.key, attempt)}`,
      `Plugin "${input.pluginId}" generated module "${input.id}" artifact path`,
    );
    const file = `./${GENERATED_IR_DIR}/plugins/${specifierPath}${input.extension}`;
    const specifier = `evjs:generated/${specifierPath}`;
    return {
      key: input.key,
      id: input.id,
      pluginId: input.pluginId,
      scope: input.scope,
      source: input.source,
      extension: input.extension,
      file,
      absoluteFile: path.resolve(this.options.cwd, file),
      specifier,
    };
  }

  private reserveKey(
    pluginId: string,
    id: string,
    label: string,
    namespace?: string,
  ): string {
    const key = namespace
      ? `${pluginId}:@evjs/${namespace.length}:${namespace}:${id}`
      : `${pluginId}:${id}`;
    const existing = this.seenKeys.get(key);
    if (existing) {
      throw new Error(
        `[evjs] Duplicate contribution id "${id}" in plugin "${pluginId}". It was already used by ${existing}.`,
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
    slot.slot === "server.entry" ||
    slot.slot === "page.wrapper" ||
    slot.slot === "html.tag"
  );
}

/** Render every generated leaf before publication mutates canonical `.ev`. */
function renderGeneratedIRImage(
  cwd: string,
  graph: CoreGraph,
  plan: BuildPlan,
  modules: InternalGeneratedModule[],
  generated: GeneratedFrameworkPlan,
  injectBundledCoreJs: boolean,
): GeneratedIRImage {
  const rootDir = path.resolve(cwd, GENERATED_IR_DIR);
  const files = new Map<string, GeneratedIRImageFile>();
  const addFile = (absoluteFile: string, source: string): void => {
    const file = toGeneratedIRImagePath(rootDir, absoluteFile);
    if (file === GENERATED_IR_MANIFEST) {
      throw new Error(
        `[evjs] Generated IR leaf "${file}" conflicts with the reserved completion manifest.`,
      );
    }
    if (files.has(file)) {
      throw new Error(`[evjs] Generated IR leaf "${file}" was rendered twice.`);
    }
    files.set(file, Object.freeze({ file, source }));
  };

  addFile(path.join(rootDir, GENERATED_IR_TYPES), createGeneratedTypesSource());
  addFile(
    path.join(rootDir, "framework/core-graph.json"),
    stringifyGeneratedJson({ generatedBy: "evjs", graph }),
  );
  addFile(
    path.join(rootDir, "framework/build-plan.json"),
    stringifyGeneratedJson({ version: 1, generatedBy: "evjs", plan }),
  );

  for (const module of modules) {
    if (module.resolvedSource === undefined) {
      throw new Error(
        `[evjs] Generated module "${module.key}" source was not resolved before rendering.`,
      );
    }
    addFile(
      module.absoluteFile,
      withGeneratedHeader(module.resolvedSource, module.extension, {
        fromFile: module.absoluteFile,
        rootDir,
      }),
    );
  }

  for (const entry of generated.entries) {
    const buildEntry = plan.entries.find((item) => item.name === entry.name);
    if (!buildEntry) {
      throw new Error(
        `[evjs] Generated entry "${entry.name}" has no matching BuildPlan entry.`,
      );
    }
    const absoluteFile = path.resolve(cwd, entry.file);
    addFile(
      absoluteFile,
      withGeneratedHeader(
        createEntrySource(cwd, buildEntry, entry, plan, injectBundledCoreJs),
        ".ts",
        { fromFile: absoluteFile, rootDir },
      ),
    );
  }

  return Object.freeze({
    files: Object.freeze(
      [...files.values()].sort((left, right) =>
        left.file.localeCompare(right.file),
      ),
    ),
    manifest: stringifyGeneratedJson(createManifestView(plan, graph)),
  });
}

/**
 * Replace canonical `.ev` directly from a fully rendered image.
 *
 * There is deliberately no whole-tree candidate or previous snapshot. A
 * failed publication leaves `manifest.json` absent, so the incomplete tree is
 * never mistaken for a complete framework IR generation.
 */
export async function publishFrameworkIR(
  cwd: string,
  image: GeneratedIRImage,
): Promise<void> {
  const rootDir = path.resolve(cwd, GENERATED_IR_DIR);
  const prepared = validateGeneratedIRImage(rootDir, image);

  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.mkdir(rootDir, { recursive: true });
  for (const { file, source } of prepared.files) {
    const outputFile = path.resolve(rootDir, ...file.split("/"));
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, source, "utf-8");
  }

  const manifestFile = path.join(rootDir, GENERATED_IR_MANIFEST);
  try {
    await fs.writeFile(manifestFile, prepared.manifest, "utf-8");
  } catch (error) {
    await fs.rm(manifestFile, { force: true }).catch(() => {});
    throw error;
  }
}

function createGeneratedTypesSource(): string {
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

function stringifyGeneratedJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("[evjs] Generated IR JSON value is not serializable.");
  }
  return `${serialized}\n`;
}

function toGeneratedIRImagePath(rootDir: string, absoluteFile: string): string {
  const relative = toPosixPath(path.relative(rootDir, absoluteFile));
  assertGeneratedIRImagePath(relative);
  return relative;
}

function assertGeneratedIRImagePath(file: string): void {
  if (
    file === "" ||
    file === "." ||
    file.includes("\\") ||
    path.posix.isAbsolute(file) ||
    path.posix.normalize(file) !== file ||
    file === ".." ||
    file.startsWith("../")
  ) {
    throw new Error(
      `[evjs] Generated IR image path ${JSON.stringify(file)} must be a normalized portable path inside .ev.`,
    );
  }
}

function validateGeneratedIRImage(
  rootDir: string,
  image: GeneratedIRImage,
): { files: GeneratedIRImageFile[]; manifest: string } {
  if (!image || typeof image !== "object") {
    throw new TypeError("[evjs] Generated IR image must be an object.");
  }
  if (!Array.isArray(image.files)) {
    throw new TypeError("[evjs] Generated IR image files must be an array.");
  }
  if (typeof image.manifest !== "string") {
    throw new TypeError("[evjs] Generated IR image manifest must be a string.");
  }

  const seen = new Set<string>();
  const files = image.files.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new TypeError(
        `[evjs] Generated IR image files[${index}] must be an object.`,
      );
    }
    const { file, source } = entry;
    if (typeof file !== "string" || typeof source !== "string") {
      throw new TypeError(
        `[evjs] Generated IR image files[${index}] must contain string file and source fields.`,
      );
    }
    assertGeneratedIRImagePath(file);
    if (file === GENERATED_IR_MANIFEST) {
      throw new Error(
        `[evjs] Generated IR image files must not contain reserved ${GENERATED_IR_MANIFEST}; provide it through image.manifest.`,
      );
    }
    if (seen.has(file)) {
      throw new Error(
        `[evjs] Generated IR image contains duplicate "${file}".`,
      );
    }
    seen.add(file);
    const absoluteFile = path.resolve(rootDir, ...file.split("/"));
    const relativeToRoot = path.relative(rootDir, absoluteFile);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new Error(
        `[evjs] Generated IR image path ${JSON.stringify(file)} escapes .ev.`,
      );
    }
    return { file, source };
  });

  files.sort((left, right) => left.file.localeCompare(right.file));
  return { files, manifest: image.manifest };
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
export function createFrameworkView(
  graph: CoreGraph,
  plan: BuildPlan,
): FrameworkView {
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

function createFrameworkRouteViews(graph: CoreGraph): FrameworkView["routes"] {
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
): FrameworkView["pages"][number] {
  return {
    id: page.id,
    applicationId: page.applicationId,
    source: {
      module: page.source.module,
      scope: cloneJson(page.source.scope),
      provider: page.source.provider,
      ...(page.source.config ? { config: page.source.config } : {}),
    },
    plugins: createFrameworkPagePluginSettingsView(page.plugins),
    render: page.render,
    ...(page.componentModel ? { componentModel: page.componentModel } : {}),
    ...(page.hydrate ? { hydrate: page.hydrate } : {}),
    ...(page.prerender ? { prerender: cloneJson(page.prerender) } : {}),
    ...(page.ppr ? { ppr: cloneJson(page.ppr) } : {}),
    ...(page.metadata ? { metadata: cloneJson(page.metadata) } : {}),
    provenance: cloneJson(page.provenance),
  };
}

function createFrameworkPagePluginSettingsView(
  settings: CoreGraph["pages"][string]["plugins"],
): FrameworkView["pages"][number]["plugins"] {
  return Object.fromEntries(
    Object.entries(settings).map(([id, setting]) =>
      setting.enabled
        ? [id, { enabled: true, options: cloneJson(setting.options) }]
        : [id, { enabled: false }],
    ),
  );
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
  pluginId: string,
  id: string,
): BuildEntry {
  const entry = plan.entries.find((item) => item.name === view.name);
  if (entry) return entry;
  throw new Error(
    `[evjs] Plugin "${pluginId}" entry facade "${id}" references unknown framework entry "${view.name}".`,
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
  injectBundledCoreJs: boolean,
): GeneratedEntryPlan[] {
  const used = new Set<string>();
  return plan.entries
    .filter((entry) =>
      shouldGenerateEntry(entry, plan, generated, injectBundledCoreJs),
    )
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
  injectBundledCoreJs: boolean,
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
      injectBundledCoreJs ||
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

function createEntrySource(
  cwd: string,
  entry: BuildEntry,
  generatedEntry: GeneratedEntryPlan,
  plan: BuildPlan,
  injectBundledCoreJs: boolean,
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
      injectBundledCoreJs,
      mainSource: createPagesAppEntryMainSource(entry.metadata, importFile),
    });
  }
  if (entry.metadata?.type === "react-component-page") {
    return createClientEntrySource({
      cwd,
      entry,
      fromFile,
      plan,
      injectBundledCoreJs,
      mainSource: createReactComponentPageEntryMainSource(
        entry.metadata,
        importFile,
      ),
    });
  }
  if (entry.metadata?.type === "react-server-page") {
    const mainSource = createReactServerPageEntrySource(
      entry.metadata,
      entry.kind,
      importFile,
    );
    return entry.kind === "page-server"
      ? composePageServerEntrySource({ cwd, entry, fromFile, plan, mainSource })
      : mainSource;
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
      injectBundledCoreJs,
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
  const mainSource = [
    `export { PageProvider } from "@evjs/ev/_internal/client/page-context";`,
    `export { default } from ${JSON.stringify(mod)};`,
    `export * from ${JSON.stringify(mod)};`,
  ].join("\n");
  return entry.kind === "page-server"
    ? composePageServerEntrySource({ cwd, entry, fromFile, plan, mainSource })
    : mainSource;
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
  injectBundledCoreJs: boolean;
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
    ...(options.injectBundledCoreJs
      ? ['import "@evjs/ev/_internal/client/polyfill";']
      : []),
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

/** Compose imports around one Page server entry or its replacement facade. */
function composePageServerEntrySource(options: {
  cwd: string;
  entry: BuildEntry;
  fromFile: string;
  plan: BuildPlan;
  mainSource: string;
}): string {
  const entrySlots = getMatchingServerEntrySlots(options.plan, options.entry);
  const replacements = entrySlots.filter((slot) => slot.mode === "replace");
  if (replacements.length > 1) {
    throw new Error(
      `[evjs] Server page entry "${options.entry.name}" has multiple replacement server.entry contributions: ${replacements
        .map((slot) => slot.key)
        .join(", ")}.`,
    );
  }

  const importsFor = (position: ServerEntrySlotPlanItem["position"]) =>
    entrySlots
      .filter((slot) => slot.position === position && slot.mode !== "replace")
      .map((slot) =>
        importSlotModule(options.cwd, options.fromFile, slot.module, position),
      );
  const replacement = replacements[0];
  const mainSource = replacement
    ? (() => {
        const mod = toGeneratedImportSpecifier(
          options.cwd,
          options.fromFile,
          replacement.module,
        );
        return [
          `export { default } from ${JSON.stringify(mod)};`,
          `export * from ${JSON.stringify(mod)};`,
        ];
      })()
    : [options.mainSource];

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
  const serverFunctionModuleIndexes = new Map(
    serverFunctionModules.map((module, index) => [module, index]),
  );

  const imports = [
    `import { createApp, createRoute, createServerFunctionRegistry } from "@evjs/ev/_internal/server";`,
    `import { createReactFrameworkServer } from "@evjs/ev/_internal/server/react";`,
    ...(serverFunctionModules.length > 0
      ? [
          `import { getServerReferenceId } from "@evjs/ev/_internal/server/server-reference";`,
        ]
      : []),
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
      (module, index) =>
        `import * as serverFunctionModule${index} from ${JSON.stringify(
          toGeneratedImportSpecifier(cwd, fromFile, module),
        )};`,
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
  const serverFunctionRegistrations = (metadata.serverFunctions ?? []).flatMap(
    (serverFunction, index) => {
      const moduleIndex = serverFunctionModuleIndexes.get(
        serverFunction.module,
      );
      if (moduleIndex === undefined) {
        throw new Error(
          `[evjs] Missing generated server function module "${serverFunction.module}".`,
        );
      }
      const canonicalId = JSON.stringify(serverFunction.id);
      const exportName = JSON.stringify(serverFunction.exportName);
      const implementation = `serverFunctionImplementation${index}`;
      const bundlerId = `serverFunctionBundlerId${index}`;
      return [
        `const ${implementation} = serverFunctionModule${moduleIndex}[${exportName}];`,
        `serverFunctions.register(${canonicalId}, ${implementation});`,
        `const ${bundlerId} = getServerReferenceId(${implementation}, ${exportName});`,
        `if (${bundlerId} !== undefined && ${bundlerId} !== ${canonicalId}) {`,
        `  serverFunctions.register(${bundlerId}, ${implementation});`,
        `}`,
      ];
    },
  );

  return [
    ...imports,
    "",
    ...routeDefinitions,
    "",
    "const framework = createReactFrameworkServer();",
    "const serverFunctions = createServerFunctionRegistry();",
    ...serverFunctionRegistrations,
    `const middlewares = [${middlewareReferences.join(", ")}];`,
    `const routes = [${routeEntries.join(", ")}];`,
    "const app = createApp({ middlewares, routes, serverFunctions, ...(framework ? { framework } : {}) });",
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

function getMatchingServerEntrySlots(
  plan: BuildPlan,
  entry: BuildEntry,
): ServerEntrySlotPlanItem[] {
  return getSlotItems<ServerEntrySlotPlanItem>(plan, "server.entry").filter(
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
  position: EntryContributionPosition,
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

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function validateContributionId(id: string, pluginId: string): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      `[evjs] Plugin "${pluginId}" contribution id must be a non-empty string.`,
    );
  }
  if (id !== id.trim()) {
    throw new Error(
      `[evjs] Plugin "${pluginId}" contribution id "${id}" must not contain leading or trailing whitespace.`,
    );
  }
  if (id.startsWith("@evjs/")) {
    throw new Error(
      `[evjs] Plugin "${pluginId}" contribution id "${id}" uses the reserved "@evjs/" prefix.`,
    );
  }
  return id;
}

function snapshotGeneratedScope(
  pluginId: string,
  id: string,
  scope: GeneratedScope,
): GeneratedScope {
  if (!scope || typeof scope !== "object") {
    throw new Error(
      `[evjs] Plugin "${pluginId}" generated module "${id}" must declare a valid scope.`,
    );
  }
  if (scope.kind === "application" || scope.kind === "server") {
    return Object.freeze({ kind: scope.kind });
  }
  if (
    scope.kind === "page" &&
    typeof scope.pageId === "string" &&
    scope.pageId.trim()
  ) {
    return Object.freeze({ kind: "page", pageId: scope.pageId });
  }
  throw new Error(
    `[evjs] Plugin "${pluginId}" generated module "${id}" has an invalid scope.`,
  );
}

function validateContributionTarget(
  target: ContributionTarget,
): ContributionTarget {
  if (target.kind === "application") {
    if (target.applicationId !== undefined) {
      assertTrimmedString(target.applicationId, "target.applicationId");
    }
    return target.applicationId === undefined
      ? { kind: "application" }
      : { ...target };
  }
  if (target.kind === "page") {
    assertTrimmedString(target.pageId, "target.pageId");
    return { ...target };
  }
  throw new Error('[evjs] target.kind must be "application" or "page".');
}

function validateServerEntryTarget(target: unknown): {
  kind: "page";
  pageId: string;
} {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error("[evjs] server.entry target must be a Page target.");
  }
  if (Reflect.get(target, "kind") !== "page") {
    throw new Error('[evjs] server.entry target.kind must be "page".');
  }
  return validateContributionTarget(target as ContributionTarget) as {
    kind: "page";
    pageId: string;
  };
}

function assertGeneratedModuleOrString(
  pluginId: string,
  id: string,
  value: GeneratedModuleRef | string,
): void {
  if (typeof value === "string") {
    assertTrimmedString(value, `${pluginId}:${id}.module`);
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
  if (module.resolvedSource === undefined) {
    throw new Error(
      `[evjs] Generated module "${module.key}" source must be resolved before creating the generated plan.`,
    );
  }
  return {
    key: module.key,
    id: module.id,
    pluginId: module.pluginId,
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
