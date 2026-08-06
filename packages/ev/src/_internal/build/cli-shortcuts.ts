/**
 * CLI shortcuts engine for `ev dev`.
 *
 * This is the core registration + execution surface only. Core ships no
 * built-in shortcuts — not even `h` (help) — every key is contributed by a
 * plugin via the `configureShortcuts` setup hook. The engine mirrors the
 * mechanics of Vite's `bindCLIShortcuts` (readline `'line'` events, an
 * `actionRunning` guard that drops concurrent presses, and a TTY + non-CI
 * no-op default) but is bundler-agnostic and owns no default keys.
 *
 * Scope: this engine targets the standard Node dev server. The wasm/web
 * (Fetch runtime) dev surface has no Node child process and no interactive TTY
 * loop, so the engine stays a no-op there. Pass an explicit `enabled` to
 * force-enable in non-TTY tests.
 *
 * @see package "vite" `packages/vite/src/node/shortcuts.ts` (mechanical reference)
 */

import readline from "node:readline";
import { getLogger } from "@logtape/logtape";
import type {
  PluginCliShortcut,
  PluginDevSession,
} from "../../plugin/index.js";

const logger = getLogger(["evjs", "cli-shortcuts"]);

/**
 * Resolve a pressed input line to its registered shortcut, if any.
 *
 * Trims whitespace and is case-insensitive. Returns the shortcut even if its
 * `action` is `undefined`; the dispatcher decides whether to run.
 */
export function resolveShortcut(
  input: string,
  shortcuts: readonly PluginCliShortcut[],
): PluginCliShortcut | undefined {
  const key = input.trim().toLowerCase();
  if (key === "") return undefined;
  return shortcuts.find((shortcut) => shortcut.key === key);
}

/**
 * De-duplicate contributed shortcuts by key, first-writer-wins. A developer's
 * mental model is that the first plugin to claim a key owns it; later
 * duplicates are dropped so the dispatch and any help list stay stable.
 */
export function dedupeShortcuts(
  shortcuts: readonly PluginCliShortcut[],
): PluginCliShortcut[] {
  const seen = new Set<string>();
  const deduped: PluginCliShortcut[] = [];
  for (const shortcut of shortcuts) {
    if (seen.has(shortcut.key)) continue;
    seen.add(shortcut.key);
    deduped.push(shortcut);
  }
  return deduped;
}

export interface ShortcutDispatcher {
  /**
   * Dispatch one pressed input line. Concurrent presses while an action is
   * already running are dropped. Action errors are swallowed (logged) so the
   * loop survives a failing shortcut.
   */
  dispatch(input: string): Promise<void>;
}

/**
 * Build a reusable shortcut dispatcher from already-deduplicated shortcuts +
 * the live session. Exposed so the dispatch path (key matching,
 * `actionRunning` guard, action error handling) is unit-testable without
 * binding a readline interface. `bindCLIShortcuts` uses this internally.
 */
export function createShortcutDispatcher(
  session: PluginDevSession,
  shortcuts: readonly PluginCliShortcut[],
): ShortcutDispatcher {
  let actionRunning = false;
  return {
    async dispatch(input) {
      if (actionRunning) return;
      const shortcut = resolveShortcut(input, shortcuts);
      if (!shortcut || shortcut.action == null) return;
      actionRunning = true;
      try {
        await shortcut.action(session);
      } catch (error) {
        logger.error`Shortcut "${shortcut.key}" failed: ${error}`;
      } finally {
        actionRunning = false;
      }
    },
  };
}

export interface BindCLIShortcutsOptions {
  /** Shortcuts contributed by plugins, in registration order. */
  customShortcuts?: readonly PluginCliShortcut[];
}

/**
 * Bind the shortcuts readline loop to `process.stdin`.
 *
 * Core never registers a key of its own; if `customShortcuts` is empty, this
 * is a no-op that attaches no readline interface (so `ev dev` streams are
 * untouched when no plugin contributes a shortcut).
 *
 * @param session Capability handle surfaced to plugin actions.
 * @param opts    Plugin-contributed shortcuts.
 * @param enabled Defaults to `process.stdin.isTTY && !process.env.CI`, so the
 *                engine is a no-op in CI / non-TTY / programmatic runs.
 * @returns An unbind function that closes the readline interface. Always a
 *          real function (never undefined), even when disabled, so callers can
 *          invoke it unconditionally on shutdown.
 */
export function bindCLIShortcuts(
  session: PluginDevSession,
  opts: BindCLIShortcutsOptions = {},
  enabled: boolean = process.stdin.isTTY && !process.env.CI,
): () => void {
  if (!enabled) return () => {};

  const shortcuts = dedupeShortcuts(opts.customShortcuts ?? []);
  if (shortcuts.length === 0) {
    // No plugin contributed a shortcut. Don't attach a readline interface (and
    // thus never disturb process.stdin) when there is nothing to dispatch.
    return () => {};
  }
  const dispatcher = createShortcutDispatcher(session, shortcuts);

  const onLine = (raw: string): void => {
    void dispatcher.dispatch(raw);
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", onLine);

  return () => {
    rl.off("line", onLine);
    rl.close();
  };
}
