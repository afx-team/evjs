import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "@evjs/server/app";
import type { BuildOutput, BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import {
  assertFrameworkManifestShape,
  assertServerRelativeArtifactPath,
  createDeploymentMetadata,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import type { ResolvedConfig } from "../../config/index.js";
import type {
  HtmlDocumentInfo,
  PluginContext,
  PluginHooks,
} from "../../plugin/index.js";
import {
  assertBuildOutputOwnershipUnchanged,
  snapshotBuildOutputOwnership,
} from "./build-output-ownership.js";
import { resolveBuildOutputPaths } from "./build-output-paths.js";
import { createBuildResult } from "./build-result.js";
import type { BundlerBuildFacts } from "./bundler.js";
import { assertFrameworkHtmlOutputsAvailable } from "./bundler-output-files.js";
import { assertBuildEndDeploymentOutputsAvailable } from "./deployment-output-reservations.js";
import { createFrameworkHtmlDocument } from "./framework-html-document.js";
import {
  createClientRuntime,
  createFrameworkRuntime,
} from "./framework-runtime.js";
import { type generateHtml, validateHtmlTemplate } from "./html.js";
import { buildHtml } from "./html-transform.js";
import { assertSafeBuildOutputPaths } from "./output-path-safety.js";
import {
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "./owned-file-output.js";
import { runBuildOutputHooks } from "./plugin-lifecycle.js";
import {
  FRAMEWORK_DEPLOYMENT_METADATA_FILE_NAME,
  portableArtifactPathsConflict,
} from "./portable-artifact-path.js";
import { compileServerDocumentShells } from "./server-document-shell.js";

const RUNTIME_ONLY_BUNDLER_MANIFEST_FILES = [
  "react-client-manifest.json",
  "react-ssr-manifest.json",
];

interface PreviousFrameworkHtmlOutput {
  buildId: string;
  documents: Array<{
    kind: "app" | "page";
    id: string;
    fileName: string;
    aliases?: string[];
  }>;
}

export function validateHtmlTemplates<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): void {
  const templates = collectHtmlTemplates(config);
  const documents = new Map<string, HtmlTemplateDocument>();

  for (const template of templates) {
    const templatePath = path.resolve(cwd, template.path);
    let doc = documents.get(templatePath);
    if (!doc) {
      doc = readHtmlTemplateDocument(templatePath, template);
      documents.set(templatePath, doc);
    }
    validateHtmlMountTarget(template, doc);
  }
}

type HtmlTemplateDocument = ReturnType<typeof validateHtmlTemplate>;

interface HtmlTemplateValidation {
  path: string;
  notFoundMessage: string;
  notFileMessage: string;
  mount?: string;
  mountNotFoundMessage?: string;
  mountInvalidMessage?: string;
}

function readHtmlTemplateDocument(
  templatePath: string,
  template: HtmlTemplateValidation,
): HtmlTemplateDocument {
  let stat: ReturnType<typeof fs.statSync>;
  try {
    stat = fs.statSync(templatePath);
  } catch {
    throw new Error(`${template.notFoundMessage}: ${template.path}`);
  }

  if (!stat.isFile()) {
    throw new Error(`${template.notFileMessage}: ${template.path}`);
  }
  return validateHtmlTemplate({
    template: templatePath,
    displayName: template.path,
  });
}

function validateHtmlMountTarget(
  template: HtmlTemplateValidation,
  doc: HtmlTemplateDocument,
): void {
  if (!template.mount) return;
  const mountInvalidMessage =
    template.mountInvalidMessage ?? "[evjs] HTML mount selector is invalid";
  const mountNotFoundMessage =
    template.mountNotFoundMessage ?? "[evjs] HTML mount target was not found";

  let target: unknown;
  try {
    target = doc.querySelector(template.mount);
  } catch {
    throw new Error(`${mountInvalidMessage}: ${template.mount}`);
  }

  if (!target) {
    throw new Error(
      `${mountNotFoundMessage} "${template.mount}" in html template: ${template.path}`,
    );
  }
}

function collectHtmlTemplates<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
): HtmlTemplateValidation[] {
  const templates: HtmlTemplateValidation[] = [];

  if (config.application) {
    templates.push({
      path: config.application.document.template,
      notFoundMessage: "[evjs] Application Document html template not found",
      notFileMessage:
        "[evjs] Application Document html template must be a file",
      mount: config.application.document.mount,
      mountNotFoundMessage:
        "[evjs] Application Document mount target was not found",
      mountInvalidMessage:
        "[evjs] Application Document mount selector is invalid",
    });
  } else if (config.routing?.mode === "mpa") {
    let usesRoutingHtml = false;
    for (const route of config.routing.routes) {
      if (route.kind === "layout") continue;
      if (route.html) {
        templates.push({
          path: route.html,
          notFoundMessage: `[evjs] MPA page route "${route.id}" html template not found`,
          notFileMessage: `[evjs] MPA page route "${route.id}" html template must be a file`,
          mount: config.routing.mount,
          mountNotFoundMessage: `[evjs] MPA page route "${route.id}" mount target was not found`,
          mountInvalidMessage: `[evjs] MPA page route "${route.id}" mount selector is invalid`,
        });
      } else {
        usesRoutingHtml = true;
      }
    }
    if (usesRoutingHtml) {
      templates.push({
        path: config.routing.html,
        notFoundMessage: "[evjs] Page routing html template not found",
        notFileMessage: "[evjs] Page routing html template must be a file",
        mount: config.routing.mount,
        mountNotFoundMessage: "[evjs] Page routing mount target was not found",
        mountInvalidMessage: "[evjs] Page routing mount selector is invalid",
      });
    }
  } else if (config.routing) {
    templates.push({
      path: config.routing.html,
      notFoundMessage: "[evjs] Page routing html template not found",
      notFileMessage: "[evjs] Page routing html template must be a file",
      mount: config.routing.mount,
      mountNotFoundMessage: "[evjs] Page routing mount target was not found",
      mountInvalidMessage: "[evjs] Page routing mount selector is invalid",
    });
  }

  return templates;
}

function getFrameworkOutputPaths(
  cwd: string,
  output: BuildOutput,
): { rootDir: string; clientDir: string; serverDir: string } {
  const rootDir = path.resolve(cwd, output.paths.rootDir);
  const publicDir = output.paths.publicDir;
  const serverDir = output.paths.serverDir;
  return {
    rootDir,
    clientDir: path.resolve(cwd, publicDir),
    serverDir: path.resolve(cwd, serverDir),
  };
}

/**
 * Emit canonical deployment metadata and remove bundler-only runtime
 * manifests. The returned ownership snapshot is derived from the previous
 * canonical metadata and is used only for guarded stale-HTML cleanup.
 */
async function emitFrameworkManifest(
  cwd: string,
  output: BuildOutput,
): Promise<PreviousFrameworkHtmlOutput | undefined> {
  const { rootDir, clientDir } = getFrameworkOutputPaths(cwd, output);
  const previousHtmlOutput = await readPreviousFrameworkHtmlOutput(
    cwd,
    rootDir,
    clientDir,
  );
  await writeOwnedOutputFile(
    cwd,
    path.join(rootDir, FRAMEWORK_DEPLOYMENT_METADATA_FILE_NAME),
    JSON.stringify(createDeploymentMetadata(output), null, 2),
    "deployment metadata output",
  );
  await removeRuntimeOnlyBundlerManifests(cwd, clientDir);
  return previousHtmlOutput;
}

function isDeploymentMetadataSnapshot(value: Record<string, unknown>): boolean {
  return (
    hasFrameworkOutputHeader(value) &&
    Array.isArray(value.documents) &&
    Array.isArray(value.routes) &&
    isRecord(value.server) &&
    value.documents.every(isFrameworkDocumentRecord)
  );
}

function hasFrameworkOutputHeader(value: Record<string, unknown>): boolean {
  return (
    value.version === 1 &&
    isNonEmptyString(value.buildId) &&
    isRecord(value.paths) &&
    isNonEmptyString(value.paths.rootDir) &&
    isNonEmptyString(value.paths.publicDir) &&
    isNonEmptyString(value.paths.serverDir) &&
    typeof value.publicPath === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function removeRuntimeOnlyBundlerManifests(
  cwd: string,
  clientDir: string,
): Promise<void> {
  await Promise.all(
    RUNTIME_ONLY_BUNDLER_MANIFEST_FILES.map((fileName) =>
      removeOwnedOutputFile(
        cwd,
        path.join(clientDir, fileName),
        `Runtime-only bundler manifest "${fileName}"`,
      ),
    ),
  );
}

async function readPreviousFrameworkHtmlOutput(
  cwd: string,
  rootDir: string,
  clientDir: string,
): Promise<PreviousFrameworkHtmlOutput | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(
      await fs.promises.readFile(
        path.join(rootDir, FRAMEWORK_DEPLOYMENT_METADATA_FILE_NAME),
        "utf-8",
      ),
    );
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !isDeploymentMetadataSnapshot(value)) {
    return undefined;
  }
  const paths = value.paths as Record<string, unknown>;
  if (
    path.resolve(cwd, paths.rootDir as string) !== rootDir ||
    path.resolve(cwd, paths.publicDir as string) !== clientDir
  ) {
    return undefined;
  }

  return {
    buildId: value.buildId as string,
    documents: (value.documents as unknown[]).map((document) => {
      const record = document as Record<string, unknown>;
      return {
        kind: record.kind as "app" | "page",
        id: record.id as string,
        fileName: record.fileName as string,
        ...(Array.isArray(record.aliases)
          ? { aliases: [...(record.aliases as string[])] }
          : {}),
      };
    }),
  };
}

function isFrameworkDocumentRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === "app" || value.kind === "page") &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.fileName) &&
    (value.aliases === undefined ||
      (Array.isArray(value.aliases) && value.aliases.every(isNonEmptyString)))
  );
}

function getHtmlAssets(html: BuildPlan["html"][number], output: BuildOutput) {
  const pageId = html.owner.pageId;
  const appId = html.owner.appId;
  return pageId
    ? output.pages[pageId]?.assets
    : appId
      ? output.apps[appId]?.assets
      : undefined;
}

function createHtmlDocumentInfo(
  html: BuildPlan["html"][number],
  output: BuildOutput,
): HtmlDocumentInfo | undefined {
  const assets = getHtmlAssets(html, output);
  if (!assets) return undefined;

  if (html.owner.pageId) {
    return {
      documentId: html.id,
      applicationId: html.owner.appId ?? "default",
      owner: { kind: "page", pageId: html.owner.pageId },
      template: html.template,
      fileName: html.fileName,
      assets,
    };
  }

  return {
    documentId: html.id,
    applicationId: html.owner.appId ?? "default",
    owner: { kind: "application" },
    template: html.template,
    fileName: html.fileName,
    assets,
  };
}

type PageHtmlDocumentInfo = HtmlDocumentInfo & {
  owner: { kind: "page"; pageId: string };
};

async function emitFrameworkHtml<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
  hooks: PluginHooks<TBundlerCfg>[],
  pluginCtx: PluginContext<TBundlerCfg>,
  output: BuildOutput,
  plan: BuildPlan,
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime>,
  isRebuild: boolean,
  previousHtmlOutput?: PreviousFrameworkHtmlOutput,
  bundlerClientFiles?: readonly string[],
  loadServerModule?: (asset: string) => Promise<unknown>,
): Promise<void> {
  const { clientDir, serverDir } = getFrameworkOutputPaths(cwd, output);
  await removeStaleFrameworkHtml(
    cwd,
    clientDir,
    plan,
    previousHtmlOutput,
    bundlerClientFiles,
  );
  const clientRuntime = createClientRuntime(output);

  for (const html of plan.html) {
    const htmlInfo = createHtmlDocumentInfo(html, output);
    if (!htmlInfo) continue;

    const doc = createFrameworkHtmlDocument({
      cwd,
      config,
      output,
      plan,
      html: htmlInfo,
      clientRuntime,
    });
    if (shouldPrerenderStaticPage(output, htmlInfo)) {
      await prerenderStaticPageHtml({
        doc,
        output,
        html: htmlInfo,
        frameworkRuntime,
        serverDir,
        loadServerModule,
      });
    }

    const finalHtml = await buildHtml({
      doc,
      hooks,
      pluginContext: pluginCtx,
      html: htmlInfo,
      output,
      isRebuild,
    });

    for (const fileName of [html.fileName, ...(html.aliases ?? [])]) {
      const outPath = resolveContainedFile(clientDir, fileName);
      if (!outPath) {
        throw new Error(
          `[evjs] HTML Document "${html.id}" output "${fileName}" must resolve inside the client output directory.`,
        );
      }
      await writeOwnedOutputFile(
        cwd,
        outPath,
        finalHtml,
        `HTML Document "${html.id}" output "${fileName}"`,
      );
    }
  }
}

/**
 * Remove only HTML proven to belong to the previous framework build. A file is
 * preserved when it conflicts with current plan or bundler output, escapes the
 * client directory through its real path, or lacks the matching ownership
 * marker from the validated previous metadata snapshot.
 */
async function removeStaleFrameworkHtml(
  cwd: string,
  clientDir: string,
  plan: BuildPlan,
  previous: PreviousFrameworkHtmlOutput | undefined,
  bundlerClientFiles: readonly string[] | undefined,
): Promise<void> {
  if (!previous) return;
  const protectedFiles = [
    ...plan.html.flatMap((html) => [html.fileName, ...(html.aliases ?? [])]),
    ...(bundlerClientFiles ?? []),
  ];
  for (const document of previous.documents) {
    for (const fileName of [document.fileName, ...(document.aliases ?? [])]) {
      const file = resolveContainedFile(clientDir, fileName);
      if (
        file &&
        !protectedFiles.some((protectedFile) =>
          portableArtifactPathsConflict(fileName, protectedFile),
        ) &&
        (await isFrameworkOwnedHtmlFile(
          clientDir,
          file,
          previous.buildId,
          document,
        ))
      ) {
        await removeOwnedOutputFile(
          cwd,
          file,
          `Stale HTML Document "${document.id}" output "${fileName}"`,
        );
      }
    }
  }
}

function resolveContainedFile(
  directory: string,
  fileName: string,
): string | undefined {
  const file = path.resolve(directory, fileName);
  const relative = path.relative(directory, file);
  if (
    relative.length === 0 ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return file;
}

async function isFrameworkOwnedHtmlFile(
  clientDir: string,
  file: string,
  buildId: string,
  document: PreviousFrameworkHtmlOutput["documents"][number],
): Promise<boolean> {
  try {
    const [realClientDir, realFile, stat] = await Promise.all([
      fs.promises.realpath(clientDir),
      fs.promises.realpath(file),
      fs.promises.stat(file),
    ]);
    if (!stat.isFile()) return false;
    const relative = path.relative(realClientDir, realFile);
    if (
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    ) {
      return false;
    }
    const doc = validateHtmlTemplate({ template: file });
    const root = doc.documentElement;
    return (
      root?.getAttribute("data-evjs-build") === buildId &&
      root.getAttribute("data-evjs-kind") === document.kind &&
      root.getAttribute("data-evjs-id") === document.id
    );
  } catch {
    return false;
  }
}

function shouldPrerenderStaticPage(
  output: BuildOutput,
  html: HtmlDocumentInfo,
): html is PageHtmlDocumentInfo {
  if (html.owner.kind !== "page") return false;
  const page = output.pages[html.owner.pageId];
  return Boolean(
    page &&
      page.render === "ssg" &&
      page.rendering.html === "static" &&
      page.rendering.prerender === "full",
  );
}

/**
 * Render an SSG Page through the framework server with a synthetic GET, then
 * place only the rendered Page HTML into the selected Document mount. Normal
 * asset injection and plugin HTML transforms run afterward on the same DOM.
 */
async function prerenderStaticPageHtml(options: {
  doc: ReturnType<typeof generateHtml>;
  output: BuildOutput;
  html: PageHtmlDocumentInfo;
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime>;
  serverDir: string;
  loadServerModule?: (asset: string) => Promise<unknown>;
}): Promise<void> {
  const { doc, output, html, frameworkRuntime, serverDir, loadServerModule } =
    options;
  const pageId = html.owner.pageId;
  const page = output.pages[pageId];
  const pathname = findStaticPagePath(output, pageId, page);
  if (!page || !pathname) return;

  const { createReactFrameworkServer } = await import("@evjs/server/react");
  const framework = createReactFrameworkServer({
    runtime: frameworkRuntime,
    loadModule: async (asset) => {
      const safeAsset = assertServerRelativeArtifactPath(
        asset,
        `SSG Page "${pageId}" renderer artifact`,
      );
      return normalizeServerModule(
        loadServerModule
          ? await loadServerModule(safeAsset)
          : await import(
              pathToFileURL(path.resolve(serverDir, ...safeAsset.split("/")))
                .href
            ),
      );
    },
    react: {
      renderDocument(appHtml) {
        return appHtml;
      },
    },
  });
  if (!framework?.render) {
    throw new Error(
      `[evjs] Unable to prerender SSG page "${pageId}" because no server renderer was emitted.`,
    );
  }

  const app = createApp({ framework });
  const response = await app.fetch(
    new Request(new URL(pathname, "http://evjs.local").toString(), {
      method: "GET",
    }),
  );
  if (!response.ok) {
    throw new Error(
      `[evjs] Failed to prerender SSG page "${pageId}": ${response.status} ${response.statusText}`,
    );
  }

  const mount = doc.querySelector(page.mount ?? "#app");
  if (!mount) {
    throw new Error(
      `[evjs] Unable to prerender SSG page "${pageId}" because mount target "${page.mount ?? "#app"}" was not found.`,
    );
  }
  mount.innerHTML = await response.text();
}

function findStaticPagePath(
  output: BuildOutput,
  pageId: string,
  page: BuildOutput["pages"][string] | undefined,
): string | undefined {
  const routePath = output.routes.find(
    (route) => route.pageId === pageId,
  )?.path;
  const pathname = routePath ?? page?.path;
  if (!pathname || !isStaticPagePath(pathname)) return undefined;
  return pathname;
}

function isStaticPagePath(pathname: string): boolean {
  return !/(^|\/)(?:[$:]|[*])/.test(pathname);
}

function normalizeServerModule(mod: unknown): Record<string, unknown> {
  const nested =
    mod && typeof mod === "object" && "default" in mod
      ? (mod as { default?: unknown }).default
      : undefined;
  return nested &&
    typeof nested === "object" &&
    ("default" in nested || "render" in nested || "fetch" in nested)
    ? (nested as Record<string, unknown>)
    : (mod as Record<string, unknown>);
}

/**
 * Complete the post-bundler control-plane phase. Bundler facts are linked to
 * graph and plan ownership, buildOutput hooks may adjust asset groups and
 * deployment metadata without changing that ownership, and request-time
 * Document shells are compiled before runtime projection.
 *
 * The deployed runtime excludes build-only renderers; a separate build runtime
 * includes them for SSG emission. Deployment output reservations are validated
 * before canonical metadata and transformed HTML are written.
 */
export async function linkAndEmitBuildOutput<TBundlerCfg>(options: {
  bundlerFacts: BundlerBuildFacts;
  graph: CoreGraph;
  plan: BuildPlan;
  config: ResolvedConfig<TBundlerCfg>;
  cwd: string;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginCtx: PluginContext<TBundlerCfg>;
  isRebuild: boolean;
}): Promise<{
  output: BuildOutput;
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime>;
}> {
  await assertSafeBuildOutputPaths(
    options.cwd,
    resolveBuildOutputPaths(options.cwd, options.plan),
  );
  assertFrameworkHtmlOutputsAvailable(
    options.plan,
    options.bundlerFacts.emittedFiles,
  );
  const output = structuredClone(
    linkBuildOutput({
      graph: options.graph,
      plan: options.plan,
      clientEntryAssets: options.bundlerFacts.clientEntryAssets,
      serverEntryAssets: options.bundlerFacts.serverEntryAssets,
      serverEntry: options.bundlerFacts.serverEntry,
      serverAssets: options.bundlerFacts.serverAssets,
      serverModules: options.bundlerFacts.serverModules,
    }),
  );

  assertFrameworkManifestShape(output, "linked BuildOutput");
  const ownership = snapshotBuildOutputOwnership(output);
  const assertBuildOutputHookResult = () => {
    assertBuildOutputOwnershipUnchanged(ownership, output);
    assertFrameworkManifestShape(output, "BuildOutput after buildOutput hooks");
  };
  await runBuildOutputHooks(
    options.hooks,
    output,
    options.pluginCtx,
    assertBuildOutputHookResult,
  );
  assertBuildOutputHookResult();
  const documentShells = await compileServerDocumentShells({
    cwd: options.cwd,
    config: options.config,
    hooks: options.hooks,
    pluginCtx: options.pluginCtx,
    output,
    plan: options.plan,
    isRebuild: options.isRebuild,
  });
  const frameworkRuntime = createFrameworkRuntime(output, {
    rscManifests: options.bundlerFacts.rscManifests,
    documentShells,
  });
  const buildFrameworkRuntime = createFrameworkRuntime(output, {
    rscManifests: options.bundlerFacts.rscManifests,
    documentShells,
    includeBuildRenderers: true,
  });
  assertBuildEndDeploymentOutputsAvailable(
    options.hooks,
    createBuildResult(output, options.isRebuild, { frameworkRuntime }),
    { cwd: options.cwd, emittedFiles: options.bundlerFacts.emittedFiles },
  );
  const previousHtmlOutput = await emitFrameworkManifest(options.cwd, output);
  await emitFrameworkHtml(
    options.cwd,
    options.config,
    options.hooks,
    options.pluginCtx,
    output,
    options.plan,
    buildFrameworkRuntime,
    options.isRebuild,
    previousHtmlOutput,
    options.bundlerFacts.emittedFiles?.client,
    options.bundlerFacts.loadServerModule,
  );

  return { output, frameworkRuntime };
}
