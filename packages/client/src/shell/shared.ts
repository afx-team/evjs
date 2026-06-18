import { getSharedScope } from "./registry.js";
import { assertSharedScope } from "./shared-scope.js";
import type { SharedScope } from "./types.js";

export function createShellSharedScope(
  shared: SharedScope | undefined,
): SharedScope {
  const globalShared = getSharedScope();
  assertSharedScope(globalShared, "[evjs] global shared scope");
  assertSharedScope(shared, "[evjs] createShell() shared");

  return {
    ...globalShared,
    ...(shared ?? {}),
  };
}

export { assertSharedScope } from "./shared-scope.js";
