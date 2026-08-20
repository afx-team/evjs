/**
 * CLI shortcuts engine for `ev dev`.
 *
 * This is the core registration + execution surface only. Core ships no
 * built-in shortcuts — not even `h` (help) — every key is contributed by a
 * plugin via the descriptor-level `cliShortcuts()` contribution. The engine mirrors the
 * mechanics of Vite's `bindCLIShortcuts` (readline `'line'` events, an
 * `actionRunning` guard that drops concurrent presses, and a TTY + non-CI
 * no-op default) but is bundler-agnostic and owns no default keys.
 *
 * The engine is bundler-agnostic and binds only after the Supervisor has an
 * active immutable Session and its controller origin. Pass an explicit
 * `enabled` to force-enable in non-TTY tests.
 *
 * @see package "vite" `packages/vite/src/node/shortcuts.ts` (mechanical reference)
 */

import readline from "node:readline";
import { getLogger } from "@logtape/logtape";
import type {
  PluginCliShortcut,
  PluginDevSession,
} from "../../../plugin/index.js";

const logger = getLogger(["evjs", "cli-shortcuts"]);

function normalizeInputKey(input: string): string | undefined {
  const key = input.trim().toLowerCase();
  return [...key].length === 1 ? key : undefined;
}

/** Normalize and validate one plugin-contributed shortcut key. */
export function normalizeShortcutKey(key: string): string {
  const normalized = normalizeInputKey(key);
  if (normalized === undefined) {
    throw new Error(
      "[evjs] CLI shortcut key must be a single non-whitespace character.",
    );
  }
  return normalized;
}

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
  const key = normalizeInputKey(input);
  if (key === undefined) return undefined;
  return shortcuts.find(
    (shortcut) => normalizeShortcutKey(shortcut.key) === key,
  );
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
    const key = normalizeShortcutKey(shortcut.key);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(Object.freeze({ ...shortcut, key }));
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
  /** Whether no shortcut action is currently running. */
  isIdle(): boolean;
  /** Wait for the currently running action, if any. */
  waitForIdle(): Promise<void>;
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
  let runningAction: Promise<void> | undefined;
  return {
    async dispatch(input) {
      if (actionRunning) return;
      const shortcut = resolveShortcut(input, shortcuts);
      if (!shortcut || shortcut.action == null) return;
      actionRunning = true;
      const action = (async () => {
        try {
          await shortcut.action?.(session);
        } catch (error) {
          logger.error`Shortcut "${shortcut.key}" failed: ${error}`;
        }
      })();
      runningAction = action;
      try {
        await action;
      } finally {
        if (runningAction === action) {
          runningAction = undefined;
          actionRunning = false;
        }
      }
    },
    isIdle() {
      return runningAction === undefined;
    },
    waitForIdle() {
      return runningAction ?? Promise.resolve();
    },
  };
}

export interface UnbindCLIShortcutsOptions {
  /**
   * Maximum time to wait for the active action after input has been detached.
   * Omit to wait without a deadline; use `0` for shutdown paths that must not
   * be held open by plugin work.
   */
  actionDrainTimeoutMs?: number;
}

/**
 * Detach shortcut input and report whether the active action drained before
 * the requested deadline.
 */
export interface UnbindCLIShortcutsResult {
  readonly drained: boolean;
  /** Settles when the action that was active during unbind finishes. */
  readonly idle: Promise<void>;
}

export type UnbindCLIShortcuts = (
  options?: UnbindCLIShortcutsOptions,
) => Promise<UnbindCLIShortcutsResult>;

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
): UnbindCLIShortcuts {
  if (!enabled) {
    return async () => ({ drained: true, idle: Promise.resolve() });
  }

  const shortcuts = dedupeShortcuts(opts.customShortcuts ?? []);
  if (shortcuts.length === 0) {
    // No plugin contributed a shortcut. Don't attach a readline interface (and
    // thus never disturb process.stdin) when there is nothing to dispatch.
    return async () => ({ drained: true, idle: Promise.resolve() });
  }
  const dispatcher = createShortcutDispatcher(session, shortcuts);

  const onLine = (raw: string): void => {
    void dispatcher.dispatch(raw);
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", onLine);
  let closed = false;

  return async (options = {}) => {
    let closeError: unknown;
    if (!closed) {
      closed = true;
      try {
        rl.off("line", onLine);
        rl.close();
      } catch (error) {
        closeError = error;
      }
    }
    const idle = dispatcher.waitForIdle();
    const timeoutMs = options.actionDrainTimeoutMs;
    let drained = true;
    if (timeoutMs === undefined) {
      await idle;
    } else if (timeoutMs === 0) {
      drained = dispatcher.isIdle();
    } else {
      drained = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const timeout = setTimeout(() => finish(false), timeoutMs);
        timeout.unref?.();
        void idle.then(() => finish(true));
      });
    }
    if (closeError !== undefined) throw closeError;
    return { drained, idle };
  };
}
