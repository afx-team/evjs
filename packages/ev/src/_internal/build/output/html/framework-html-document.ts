import path from "node:path";
import type { BuildOutput, BuildPlan } from "@evjs/shared/manifest";
import type { ResolvedConfig } from "../../../../config/index.js";
import type { HtmlDocumentInfo } from "../../../../plugin/index.js";
import { applyHtmlTagContributions } from "../../generated-ir/generated-contributions.js";
import type { createClientRuntime } from "../framework-runtime.js";
import { generateHtml, type HtmlAsset } from "./html.js";
import { applyPageMetadataToHtmlDocument } from "./page-metadata-html.js";

export const CLIENT_RUNTIME_SCRIPT_ID = "__EVJS_CLIENT_RUNTIME__";
const PAGE_HYDRATION_ATTRIBUTE = "data-evjs-hydrate";

export function createFrameworkHtmlDocument<TBundlerCfg>(options: {
  cwd: string;
  config: ResolvedConfig<TBundlerCfg>;
  output: BuildOutput;
  plan: BuildPlan;
  html: HtmlDocumentInfo;
  clientRuntime: ReturnType<typeof createClientRuntime>;
  purpose: "client-document" | "server-shell";
}): ReturnType<typeof generateHtml> {
  const { cwd, config, output, plan, html, clientRuntime, purpose } = options;
  const doc = generateHtml({
    template: path.resolve(cwd, html.template),
    publicPath: output.publicPath,
    js: withHtmlAssetCrossOrigin(
      html.assets.js,
      config.output.crossOriginLoading,
    ),
    css: withHtmlAssetCrossOrigin(
      html.assets.css,
      config.output.crossOriginLoading,
    ),
  });

  doc.documentElement?.setAttribute("data-evjs-build", output.buildId);
  if (html.owner.kind === "page") {
    doc.documentElement?.setAttribute("data-evjs-kind", "page");
    doc.documentElement?.setAttribute("data-evjs-id", html.owner.pageId);
  } else {
    doc.documentElement?.setAttribute("data-evjs-kind", "app");
    doc.documentElement?.setAttribute("data-evjs-id", html.applicationId);
  }
  if (html.assets.js.length > 0) {
    embedClientRuntime(doc, clientRuntime);
    const coreJs = config.polyfill?.coreJs;
    if (
      plan.mode === "production" &&
      config.target &&
      coreJs &&
      coreJs !== "bundled"
    ) {
      injectCoreJsUmd(doc, coreJs.url);
    }
  }
  if (html.owner.kind === "page") {
    const page = output.pages[html.owner.pageId];
    applyPageMetadataToHtmlDocument(doc, page?.metadata, {
      preserveBaseline: hasSpaApplicationEntry(plan, html.applicationId),
    });
    preparePageMount(doc, page, purpose);
  }
  applyHtmlTagContributions(doc, html, plan);
  return doc;
}

function injectCoreJsUmd(
  doc: ReturnType<typeof generateHtml>,
  url: string,
): void {
  const body = doc.body ?? doc.querySelector("body");
  if (!body) return;
  const script = doc.createElement("script");
  script.setAttribute("src", url);
  const runtimeScript = body.querySelector(`#${CLIENT_RUNTIME_SCRIPT_ID}`);
  if (runtimeScript) {
    body.insertBefore(script, runtimeScript);
    return;
  }
  const firstScript = body.querySelector("script[src]");
  if (firstScript) {
    body.insertBefore(script, firstScript);
    return;
  }
  body.appendChild(script);
}

function hasSpaApplicationEntry(
  plan: BuildPlan,
  applicationId: string,
): boolean {
  return plan.entries.some(
    (entry) =>
      entry.kind === "app-client" && entry.owner?.appId === applicationId,
  );
}

function withHtmlAssetCrossOrigin(
  assets: string[],
  crossOriginLoading: ResolvedConfig["output"]["crossOriginLoading"],
): HtmlAsset[] {
  if (!crossOriginLoading) return assets;
  return assets.map((url) => ({
    url,
    attrs: { crossorigin: crossOriginLoading },
  }));
}

function preparePageMount(
  doc: ReturnType<typeof generateHtml>,
  page: BuildOutput["pages"][string] | undefined,
  purpose: "client-document" | "server-shell",
): void {
  const mount = page ? doc.querySelector(page.mount ?? "#app") : null;
  if (purpose === "client-document" && page?.render === "ssr") {
    if (mount) mount.innerHTML = "";
    return;
  }
  markServerPageHydrationTarget(doc, page);
}

/** Add the server-owned hydration signal to an already generated Document. */
export function markServerPageHydrationTarget(
  doc: ReturnType<typeof generateHtml>,
  page: BuildOutput["pages"][string] | undefined,
): void {
  if (
    !page ||
    page.render === "csr" ||
    page.rendering.hydrate === "none" ||
    page.assets.js.length === 0
  ) {
    return;
  }
  doc
    .querySelector(page.mount ?? "#app")
    ?.setAttribute(PAGE_HYDRATION_ATTRIBUTE, page.rendering.hydrate);
}

function embedClientRuntime(
  doc: ReturnType<typeof generateHtml>,
  runtime: ReturnType<typeof createClientRuntime>,
): void {
  const body = doc.body ?? doc.querySelector("body");
  if (!body) return;
  const json = JSON.stringify(runtime)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const script = doc.createElement("script");
  script.id = CLIENT_RUNTIME_SCRIPT_ID;
  script.setAttribute("type", "application/json");
  script.textContent = json;
  const firstScript = body.querySelector("script[src]");
  if (firstScript) {
    body.insertBefore(script, firstScript);
    return;
  }
  body.appendChild(script);
}
