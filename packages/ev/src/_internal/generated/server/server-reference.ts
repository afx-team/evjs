import {
  assertServerFunctionExportName,
  assertServerFunctionId,
} from "@evjs/shared";

type ServerReference = (...args: never[]) => unknown;

const serverReferenceIds = new WeakMap<ServerReference, Map<string, string>>();

/**
 * Record the action ID emitted by Utoopack's directive transform.
 *
 * The generated Application entry registers discovered exports in its own
 * ServerFunctionRegistry. This bridge stores only weakly held transform
 * metadata; it does not own dispatch or process-global registration state.
 */
export function registerServerReference(
  reference: ServerReference,
  actionId: string,
  exportName: string,
): void {
  assertServerFunctionId(actionId, "registerServerReference()");
  assertServerFunctionExportName(exportName, "registerServerReference()");

  let idsByExport = serverReferenceIds.get(reference);
  if (!idsByExport) {
    idsByExport = new Map();
    serverReferenceIds.set(reference, idsByExport);
  }

  const existing = idsByExport.get(exportName);
  if (existing !== undefined && existing !== actionId) {
    throw new Error(
      `[evjs] Utoopack registered server export ${JSON.stringify(exportName)} with conflicting action IDs ${JSON.stringify(existing)} and ${JSON.stringify(actionId)}.`,
    );
  }
  idsByExport.set(exportName, actionId);
}

/** Read Utoopack transform metadata without creating dispatch state. */
export function getServerReferenceId(
  reference: ServerReference,
  exportName: string,
): string | undefined {
  return serverReferenceIds.get(reference)?.get(exportName);
}
