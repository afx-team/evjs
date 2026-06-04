import type { AppContext, SharedScope } from "@evjs/client";
import "./remote.css";

let initializedSharedReactVersion = "not-initialized";

export function init(sharedScope: SharedScope, ctx: AppContext): void {
  initializedSharedReactVersion =
    sharedScope.react?.version ??
    ctx.remote?.shared.provided.react?.version ??
    "missing";
}

export function mount(mountPoint: Element, ctx: AppContext): void {
  const sharedReactVersion =
    ctx.remote?.shared.provided["remote-react"]?.version ?? "missing";
  const sourceLabel = getRemoteSourceLabel(ctx);
  const entryId = ctx.remote?.entryId ?? "unknown";
  const requestUrl = ctx.request.url?.toString() ?? "unknown";
  mountPoint.innerHTML = [
    '<section class="crm-remote" data-testid="crm-remote-card">',
    '<div class="crm-remote__header">',
    "<div>",
    '<span class="crm-remote__badge">Remote CRM module</span>',
    "<h2>Northstar Outdoor</h2>",
    "</div>",
    `<div class="crm-remote__source">${escapeHtml(sourceLabel)}</div>`,
    "</div>",
    '<div class="crm-remote__metrics">',
    '<div class="crm-remote__metric"><span>Health score</span><strong data-testid="remote-health">92 / expansion-ready</strong></div>',
    '<div class="crm-remote__metric"><span>Next action</span><strong data-testid="remote-next-action">Schedule retention offer review</strong></div>',
    '<div class="crm-remote__metric"><span>Success owner</span><strong data-testid="remote-owner">Grace Hopper</strong></div>',
    "</div>",
    '<div class="crm-remote__details">',
    `<p data-testid="remote-entry">Entry: ${escapeHtml(entryId)}</p>`,
    `<p data-testid="remote-url">URL: ${escapeHtml(requestUrl)}</p>`,
    `<p data-testid="remote-shared">Shared remote-react: ${escapeHtml(sharedReactVersion)}</p>`,
    `<p data-testid="remote-init">Init shared react: ${escapeHtml(initializedSharedReactVersion)}</p>`,
    "</div>",
    "</section>",
  ].join("");
}

export function unmount(mountPoint: Element): void {
  mountPoint.innerHTML = "";
}

function getRemoteSourceLabel(ctx: AppContext): string {
  const baseUrl = ctx.remote?.manifest.baseUrl;
  if (!baseUrl) return "served from remote manifest";

  try {
    const url = new URL(baseUrl);
    return `served from ${url.host}`;
  } catch {
    return `served from ${baseUrl}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
