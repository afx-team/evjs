const PROCESS_MODE_KEY = Symbol.for(
  "@evjs/bundler-utoopack/process-native-mode",
);
const PROCESS_MODE_OWNER = "@evjs/bundler-utoopack";

interface UtoopackProcessModeState {
  owner: typeof PROCESS_MODE_OWNER;
  mode: "build" | "dev";
}

type ModeGlobal = typeof globalThis & {
  [PROCESS_MODE_KEY]?: UtoopackProcessModeState;
};

export function markUtoopackProcessForDev(): void {
  markUtoopackProcessMode("dev");
}

export function markUtoopackProcessForBuild(): void {
  markUtoopackProcessMode("build");
}

function markUtoopackProcessMode(mode: "build" | "dev"): void {
  const modeGlobal = globalThis as ModeGlobal;
  const current = modeGlobal[PROCESS_MODE_KEY];
  if (!current) {
    modeGlobal[PROCESS_MODE_KEY] = {
      owner: PROCESS_MODE_OWNER,
      mode,
    };
    return;
  }
  if (current.owner !== PROCESS_MODE_OWNER) {
    throw new Error(
      "[evjs] Utoopack process mode is owned by an incompatible adapter runtime. Restart the current command.",
    );
  }
  if (current.mode === mode) return;

  throw new Error(
    mode === "dev"
      ? "[evjs] Utoopack dev cannot run in a process that already hosted build. Run build and dev as separate commands."
      : "[evjs] Utoopack build cannot run in a process that already hosted dev. Run build and dev as separate commands.",
  );
}

export const __testing = {
  reset(): void {
    delete (globalThis as ModeGlobal)[PROCESS_MODE_KEY];
  },
};
