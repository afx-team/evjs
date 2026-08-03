import type {
  BuildOutput,
  BuildPlan,
  ServerDocumentShell,
} from "@evjs/shared/manifest";
import type { ResolvedConfig } from "../../config/index.js";
import type {
  HtmlDocumentInfo,
  PluginHooks,
  PluginSetupContext,
} from "../../plugin/index.js";
import {
  CLIENT_RUNTIME_SCRIPT_ID,
  createFrameworkHtmlDocument,
} from "./framework-html-document.js";
import { createClientRuntime } from "./framework-runtime.js";
import type { generateHtml } from "./html.js";
import { buildHtml } from "./html-transform.js";

const PAGE_CONTENT_MARKER = "__EVJS_SERVER_PAGE_CONTENT__";
const REQUEST_DATA_MARKER = "__EVJS_SERVER_PAGE_DATA__";
const PAGE_CONTENT_COMMENT = `<!--${PAGE_CONTENT_MARKER}-->`;
const REQUEST_DATA_COMMENT = `<!--${REQUEST_DATA_MARKER}-->`;

export async function compileServerDocumentShells<TBundlerCfg>(options: {
  cwd: string;
  config: ResolvedConfig<TBundlerCfg>;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginCtx: PluginSetupContext<TBundlerCfg>;
  output: BuildOutput;
  plan: BuildPlan;
  isRebuild: boolean;
}): Promise<Record<string, ServerDocumentShell>> {
  const { cwd, config, hooks, pluginCtx, output, plan, isRebuild } = options;
  const shells = Object.create(null) as Record<string, ServerDocumentShell>;
  const clientRuntime = createClientRuntime(output);

  for (const serverDocument of plan.server.documents ?? []) {
    if (Object.hasOwn(shells, serverDocument.pageId)) {
      throw new Error(
        `[evjs] Server document plan declares more than one template for Page "${serverDocument.pageId}".`,
      );
    }
    const page = output.pages[serverDocument.pageId];
    if (!page) {
      throw new Error(
        `[evjs] Server document plan references missing Page "${serverDocument.pageId}".`,
      );
    }
    const htmlInfo: HtmlDocumentInfo = {
      documentId: serverDocument.documentId,
      applicationId: serverDocument.applicationId,
      owner: { kind: "page", pageId: serverDocument.pageId },
      template: serverDocument.template,
      fileName: serverDocument.fileName,
      assets: page.assets,
    };
    const doc = createFrameworkHtmlDocument({
      cwd,
      config,
      output,
      plan,
      html: htmlInfo,
      clientRuntime,
    });
    insertDocumentMarkers(
      doc,
      page.mount ?? serverDocument.mount,
      serverDocument.pageId,
    );
    const html = await buildHtml({
      doc,
      hooks,
      pluginContext: pluginCtx,
      html: htmlInfo,
      output,
      isRebuild,
    });
    shells[serverDocument.pageId] = splitDocumentShell(
      html,
      serverDocument.pageId,
    );
  }

  return shells;
}

function insertDocumentMarkers(
  doc: ReturnType<typeof generateHtml>,
  mountSelector: string,
  pageId: string,
): void {
  let mount: ReturnType<typeof generateHtml> | null;
  try {
    mount = doc.querySelector(mountSelector);
  } catch {
    throw new Error(
      `[evjs] Server document for Page "${pageId}" has invalid mount selector "${mountSelector}".`,
    );
  }
  if (!mount) {
    throw new Error(
      `[evjs] Server document for Page "${pageId}" cannot find mount target "${mountSelector}" after HTML contributions.`,
    );
  }

  mount.innerHTML = "";
  mount.appendChild(doc.createComment(PAGE_CONTENT_MARKER));

  const body = doc.body;
  if (!body) {
    throw new Error(
      `[evjs] Server document for Page "${pageId}" is missing its <body> after HTML contributions.`,
    );
  }
  const dataMarker = doc.createComment(REQUEST_DATA_MARKER);
  const runtimeScript = doc.getElementById(CLIENT_RUNTIME_SCRIPT_ID);
  const firstAssetScript = body.querySelector("script[src]");
  const dataAnchor = runtimeScript ?? firstAssetScript;
  if (dataAnchor) {
    body.insertBefore(dataMarker, dataAnchor);
    return;
  }
  body.appendChild(dataMarker);
}

function splitDocumentShell(html: string, pageId: string): ServerDocumentShell {
  const contentStart = html.indexOf(PAGE_CONTENT_COMMENT);
  const dataStart = html.indexOf(REQUEST_DATA_COMMENT);
  const hasOneContentMarker =
    contentStart >= 0 &&
    contentStart === html.lastIndexOf(PAGE_CONTENT_COMMENT);
  const hasOneDataMarker =
    dataStart >= 0 && dataStart === html.lastIndexOf(REQUEST_DATA_COMMENT);
  if (!hasOneContentMarker || !hasOneDataMarker || contentStart >= dataStart) {
    throw new Error(
      `[evjs] Server document for Page "${pageId}" must preserve exactly one Page-content marker followed by exactly one request-data marker through transformHtml hooks.`,
    );
  }

  return {
    beforeContent: html.slice(0, contentStart),
    betweenContentAndData: html.slice(
      contentStart + PAGE_CONTENT_COMMENT.length,
      dataStart,
    ),
    afterData: html.slice(dataStart + REQUEST_DATA_COMMENT.length),
  };
}
