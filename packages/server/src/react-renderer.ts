import type {
  AssetGroup,
  BuildOutput,
  PageOutput,
  RouteOutput,
  ServerRendererOutput,
} from "@evjs/shared/manifest";
import { type ComponentType, createElement } from "react";
import { renderToString } from "react-dom/server";
import type { RscCoordinator, RscFlightContext } from "./framework.js";

export interface ReactServerRenderContext {
  request: Request;
  manifest: BuildOutput;
  route?: RouteOutput;
  page?: PageOutput;
  pageId?: string;
}

export type ReactServerRendererModule = Record<string, unknown>;

export type ReactServerRenderResult =
  | Response
  | string
  | {
      html: string;
      status?: number;
      headers?: HeadersInit;
    };

export interface ReactServerRenderAdapterOptions {
  createProps?(
    ctx: ReactServerRenderContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  renderDocument?(
    appHtml: string,
    ctx: ReactServerRenderContext,
  ): ReactServerRenderResult | Promise<ReactServerRenderResult>;
}

export interface ReactRscFlightAdapterOptions {
  loadModule?: (
    asset: string,
    renderer: ServerRendererOutput,
  ) => Promise<ReactServerRendererModule>;
  createProps?(
    ctx: RscFlightContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  renderFlight?(ctx: RscFlightContext): Response | Promise<Response>;
  onError?(error: unknown, ctx: RscFlightContext): void | Promise<void>;
  validateContentType?: boolean;
}

export interface ReactRscPayload {
  version: 1;
  type: "evjs.rsc";
  buildId: string;
  endpoint?: string;
  pageId?: string;
  renderer?: string;
  html?: string;
  assets: AssetGroup;
  clientReferences?: Record<string, unknown>;
  serverReferences?: Record<string, unknown>;
  pages?: NonNullable<BuildOutput["rsc"]>["pages"];
}

export function createReactServerRenderAdapter(
  options: ReactServerRenderAdapterOptions = {},
) {
  return async (
    module: ReactServerRendererModule,
    ctx: ReactServerRenderContext,
  ): Promise<ReactServerRenderResult | undefined> => {
    if (typeof module.default !== "function") return undefined;

    const Component = module.default as ComponentType<Record<string, unknown>>;
    const props = options.createProps
      ? await options.createProps(ctx)
      : defaultProps(ctx);
    const appHtml = renderToString(createElement(Component, props));

    if (options.renderDocument) {
      return options.renderDocument(appHtml, ctx);
    }

    return {
      html: renderDefaultDocument(appHtml, ctx),
    };
  };
}

export function createReactRscFlightAdapter(
  options: ReactRscFlightAdapterOptions = {},
): RscCoordinator {
  return {
    match(ctx) {
      return Boolean(
        ctx.manifest.runtime.server?.rsc &&
          ctx.pageId &&
          ctx.page?.render === "rsc" &&
          ctx.rscPage &&
          ctx.renderer,
      );
    },
    async renderFlight(ctx) {
      try {
        if (options.renderFlight) {
          return validateFlightResponse(
            await options.renderFlight(ctx),
            options,
          );
        }

        const rendered = await renderDefaultRscPayload(ctx, options);
        if (rendered instanceof Response) {
          return validateFlightResponse(rendered, options);
        }

        return new Response(
          "[evjs] RSC Flight renderer is not configured for this page.",
          {
            status: 501,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          },
        );
      } catch (error) {
        await options.onError?.(error, ctx);
        return new Response(
          `[evjs] RSC Flight render failed: ${formatUnknownError(error)}`,
          {
            status: 500,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          },
        );
      }
    },
  };
}

function validateFlightResponse(
  response: Response,
  options: ReactRscFlightAdapterOptions,
): Response {
  if (options.validateContentType === false || response.status >= 400) {
    return response;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("text/x-component")) return response;

  return new Response(
    `[evjs] RSC Flight renderer returned invalid Content-Type "${contentType || "missing"}".`,
    {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

async function renderDefaultRscPayload(
  ctx: RscFlightContext,
  options: ReactRscFlightAdapterOptions,
): Promise<ReactRscPayload | Response> {
  const rendererName = ctx.rscPage?.renderer;
  const renderer = rendererName ? ctx.renderer : undefined;
  const html = renderer
    ? await renderRscRendererModule(ctx, renderer, options)
    : undefined;
  if (html instanceof Response) return html;

  return {
    version: 1,
    type: "evjs.rsc",
    buildId: ctx.manifest.buildId,
    endpoint: ctx.manifest.rsc?.endpoint ?? ctx.manifest.runtime.server?.rsc,
    pageId: ctx.pageId,
    renderer: rendererName,
    html,
    assets: ctx.rscPage?.assets ?? emptyAssets(),
    clientReferences: ctx.manifest.rsc?.clientReferences,
    serverReferences: ctx.manifest.rsc?.serverReferences,
    pages: ctx.manifest.rsc?.pages ?? {},
  };
}

async function renderRscRendererModule(
  ctx: RscFlightContext,
  renderer: ServerRendererOutput,
  options: ReactRscFlightAdapterOptions,
): Promise<string | Response | undefined> {
  const asset = renderer.assets.js[0];
  if (!asset || !options.loadModule) return undefined;

  const module = await options.loadModule(asset, renderer);
  const customFlight = getModuleFunction(module, "renderFlight");
  if (customFlight) {
    const result = await customFlight(ctx);
    if (result instanceof Response) return result;
    if (typeof result === "string") return result;
    if (isHtmlResult(result)) return result.html;
    return undefined;
  }

  const customRsc = getModuleFunction(module, "renderRsc");
  if (customRsc) {
    const result = await customRsc(ctx);
    if (result instanceof Response) return result;
    if (typeof result === "string") return result;
    if (isHtmlResult(result)) return result.html;
    return undefined;
  }

  if (typeof module.default !== "function") return undefined;

  const Component = module.default as ComponentType<Record<string, unknown>>;
  const props = options.createProps
    ? await options.createProps(ctx)
    : defaultRscProps(ctx);
  return renderToString(createElement(Component, props));
}

function getModuleFunction(
  module: ReactServerRendererModule,
  name: "renderFlight" | "renderRsc",
): ((ctx: RscFlightContext) => unknown | Promise<unknown>) | undefined {
  return typeof module[name] === "function"
    ? (module[name] as (ctx: RscFlightContext) => unknown | Promise<unknown>)
    : undefined;
}

function isHtmlResult(value: unknown): value is { html: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { html?: unknown }).html === "string",
  );
}

function defaultRscProps(ctx: RscFlightContext): Record<string, unknown> {
  return {
    request: ctx.request,
    manifest: ctx.manifest,
    page: ctx.page,
    pageId: ctx.pageId,
    rscPage: ctx.rscPage,
  };
}

function defaultProps(ctx: ReactServerRenderContext): Record<string, unknown> {
  return {
    request: ctx.request,
    manifest: ctx.manifest,
    route: ctx.route,
    page: ctx.page,
    pageId: ctx.pageId,
  };
}

function renderDefaultDocument(
  appHtml: string,
  ctx: ReactServerRenderContext,
): string {
  const mount = resolveMount(ctx.page?.mount);
  const assets = ctx.page?.assets ?? emptyAssets();

  return [
    "<!doctype html>",
    `<html data-evjs-kind="page" data-evjs-id="${escapeHtmlAttr(ctx.pageId ?? "")}" data-evjs-page="${escapeHtmlAttr(ctx.pageId ?? "")}" data-evjs-build="${escapeHtmlAttr(ctx.manifest.buildId)}">`,
    "<head>",
    ...assets.css.map(
      (asset) =>
        `<link rel="stylesheet" href="${escapeHtmlAttr(assetHref(ctx.manifest, asset))}">`,
    ),
    "</head>",
    "<body>",
    `<div ${mount.attribute}="${escapeHtmlAttr(mount.value)}">${appHtml}</div>`,
    ...assets.js.map(
      (asset) =>
        `<script type="module" src="${escapeHtmlAttr(assetHref(ctx.manifest, asset))}"></script>`,
    ),
    "</body>",
    "</html>",
  ].join("");
}

function resolveMount(mount: string | undefined): {
  attribute: "id" | "data-evjs-mount";
  value: string;
} {
  if (!mount || mount === "#app") return { attribute: "id", value: "app" };
  if (mount.startsWith("#") && mount.length > 1) {
    return { attribute: "id", value: mount.slice(1) };
  }
  return { attribute: "data-evjs-mount", value: mount };
}

function assetHref(manifest: BuildOutput, asset: string): string {
  const publicPath = manifest.publicPath;
  if (typeof publicPath !== "string") return asset;
  if (/^(?:https?:)?\/\//.test(asset) || asset.startsWith("/")) return asset;
  const base = publicPath.endsWith("/") ? publicPath : `${publicPath}/`;
  return `${base}${asset}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyAssets(): AssetGroup {
  return { js: [], css: [] };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
