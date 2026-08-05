/**
 * CLI shortcuts engine for `ev dev`.
 *
 * This is the core registration + execution surface only. It deliberately ships
 * no built-in shortcuts (no `r`/`u`/`o`/`c`/`q`): plugins contribute every
 * shortcut via the `configureShortcuts` setup hook. The engine mirrors the
 * mechanics of Vite's `bindCLIShortcuts` (readline `'line'` events, an
 * `actionRunning` guard that drops concurrent presses, and a TTY + non-CI
 * no-op default) but is bundler-agnostic and owns no default keys.
 *
 * Scope: this engine targets the standard Node dev server — the utoopack dev
 * worker (the stdin/TTY owner) plus the Hono API server child owned by
 * `restartApiServer`. The wasm/web (Fetch runtime) dev surface has no Node
 * child process and no interactive TTY loop, so the engine stays a no-op
 * there. Pass an explicit `enabled` to force-enable in non-TTY tests.
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
 * Capability handle passed to plugin-registered shortcut actions.
 *
 * Canonical alias of {@link PluginDevSession}; defined on the build side so
 * `_internal/build` callers can name it without depending on the plugin
 * surface. `origin` is the client dev server URL reported by
 * `BundlerDevContext.callbacks.onDevServerReady({ origin })`.
 */
export type DevSession = PluginDevSession;

/** A single keyboard shortcut contributed by a plugin. */
export type CLIShortcut = PluginCliShortcut;

export interface BindCLIShortcutsOptions {
  /**
   * Print a one-line hint (`press h + enter to show help`) after binding.
   * Only meaningful when {@link helpKey} is true.
   */
  print?: boolean;
  /** Shortcuts contributed by plugins, in registration order. */
  customShortcuts?: readonly CLIShortcut[];
  /**
   * When true, register an `h` help action that lists every shortcut's key +
   * description. Default `false` so core owns no keys; plugins may register `h`.
   */
  helpKey?: boolean;
  /**
   * Readable stream the readline interface binds to. Defaults to
   * `process.stdin`. Exposed primarily for tests; production callers pass TTY
   * stdin and let the {@link enabled} gate handle non-TTY/CI no-ops.
   */
  input?: NodeJS.ReadableStream | NodeJS.ReadStream;
}

/**
 * Bind the shortcuts readline loop to `process.stdin`.
 *
 * @param session Capability handle surfaced to plugin actions.
 * @param opts    Plugin-contributed shortcuts + help/print toggles.
 * @param enabled Defaults to `process.stdin.isTTY && !process.env.CI`, so the
 *                engine is a no-op in CI / non-TTY / programmatic runs.
 * @returns An unbind function that closes the readline interface. Always a
 *          real function (never undefined), even when disabled, so callers can
 *          invoke it unconditionally on shutdown.
 */
export function bindCLIShortcuts(
  session: DevSession,
  opts: BindCLIShortcutsOptions = {},
  enabled: boolean = process.stdin.isTTY && !process.env.CI,
): () => void {
  if (!enabled) return () => {};

  // First-writer-wins: an earlier plugin's key wins; later duplicates are
  // dropped. This keeps the help list stable and matches a developer's
  // mental model that the first plugin to claim a key owns it.
  const seen = new Set<string>();
  const customShortcuts: readonly CLIShortcut[] = (
    opts.customShortcuts ?? []
  ).filter((shortcut) => {
    if (seen.has(shortcut.key)) return false;
    seen.add(shortcut.key);
    return true;
  });

  const shortcuts = opts.helpKey
    ? [
        {
          key: "h",
          description: "show help",
          action() {
            printShortcutHelp(customShortcuts);
          },
        },
        ...customShortcuts,
      ]
    : customShortcuts;

  if (shortcuts.length === 0) {
    // Nothing to bind. Avoid attaching a readline interface (and stealing
    // stdin) when no plugin registered a shortcut and help is disabled.
    return () => {};
  }

  if (opts.print && opts.helpKey) {
    logger.info`  ➜  press h + enter to show help`;
  }

  let actionRunning = false;
  const rl = readline.createInterface({ input: opts.input ?? process.stdin });

  const onLine = async (raw: string): Promise<void> => {
    if (actionRunning) return;
    const input = raw.trim().toLowerCase();
    if (input === "") return;
    const shortcut = shortcuts.find((candidate) => candidate.key === input);
    if (!shortcut || shortcut.action == null) return;
    actionRunning = true;
    try {
      await shortcut.action(session);
    } catch (error) {
      logger.error`Shortcut "${shortcut.key}" failed: ${error}`;
    } finally {
      actionRunning = false;
    }
  };

  rl.on("line", onLine);

  return () => {
    rl.off("line", onLine);
    rl.close();
  };
}

function printShortcutHelp(customShortcuts: readonly CLIShortcut[]): void {
  const loggedKeys = new Set<string>();
  const lines: readonly string[] = [
    "",
    "  Shortcuts",
    ...customShortcuts.flatMap((shortcut) => {
      if (loggedKeys.has(shortcut.key)) return [];
      loggedKeys.add(shortcut.key);
      if (shortcut.action == null) return [];
      return [`  press ${shortcut.key} + enter to ${shortcut.description}`];
    }),
  ];
  for (const line of lines) {
    logger.info`${line}`;
  }
}
