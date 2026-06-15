/** Information about a discovered server route module. */
export interface RouteModuleInfo {
  /** Absolute path to the route module file. */
  path: string;
  /** Exported names of the route handlers. */
  exports: string[];
}

/** Options for transforming a "use server" file. */
export interface TransformOptions {
  /** Absolute path to the source file. */
  resourcePath: string;
  /** Root directory of the project. */
  rootContext: string;
  /** Whether this is a server-side build. */
  isServer: boolean;
  /** Callback to register a server function in the manifest. */
  onServerFn?: (fnId: string) => void;
}

/**
 * Runtime identifiers used in generated code.
 *
 * These are build-time constants — the actual module paths and function names
 * that appear in codegen output. They must stay in sync with the `@evjs/ev`
 * facade exports.
 *
 * Note: `DEFAULT_ENDPOINT` (the default HTTP path for server functions) is a runtime
 * concern and lives in `@evjs/shared/src/constants.ts`, not here.
 */
export const RUNTIME = {
  /** Module path for server-side function registration (no Hono dependency). */
  serverModule: "@evjs/server/register",
  /** Module path for the server app factory (Hono app + server function handler). */
  appModule: "@evjs/server",
  /** Module path for generated client-side server reference stubs. */
  clientTransportModule: "@evjs/client/internal",
  /** Server-side function registration (RSC convention). */
  registerServerReference: "registerServerReference",
  /** Client-side server reference factory (RSC convention). */
  createServerReference: "createServerReference",
} as const;
