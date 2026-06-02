import type { AppContext, SharedScope } from "@evjs/client";

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
  mountPoint.innerHTML = [
    '<section class="status">',
    "<h2>CRM Remote</h2>",
    `<p data-testid="remote-entry">Entry: ${ctx.remote?.entryId}</p>`,
    `<p data-testid="remote-url">URL: ${ctx.request.url?.toString()}</p>`,
    `<p data-testid="remote-shared">Shared remote-react: ${sharedReactVersion}</p>`,
    `<p data-testid="remote-init">Init shared react: ${initializedSharedReactVersion}</p>`,
    "</section>",
  ].join("");
}

export function unmount(mountPoint: Element): void {
  mountPoint.innerHTML = "";
}
