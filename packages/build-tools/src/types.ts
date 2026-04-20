/** Configuration for the generated server entry. */
export interface ServerEntryConfig {
  /**
   * Explicit server entry file. If provided, overrides auto-generated entry.
   */
  entry?: string;
  /**
   * Middleware module paths to auto-register in the server entry.
   */
  middleware?: string[];
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
  onServerFn?: (
    fnId: string,
    meta: { moduleId: string; export: string },
  ) => void;
}

/**
 * Runtime identifiers used in generated code.
 *
 * These are build-time constants — the actual module paths and function names
 * that appear in codegen output. They must stay in sync with the `@evjs/client`
 * and `@evjs/server` package exports.
 *
 * Note: `DEFAULT_ENDPOINT` (the default HTTP path for server functions) is a runtime
 * concern and lives in `@evjs/shared/src/constants.ts`, not here.
 */
export const RUNTIME = {
  /** Module path for server-side function registration (no Hono dependency). */
  serverModule: "@evjs/server/register",
  /** Module path for the server app factory (Hono app + server function handler). */
  appModule: "@evjs/server",
  /** Module path for client-side transport stubs. */
  clientTransportModule: "@evjs/client/transport",
  /** Server-side function registration (RSC convention). */
  registerServerReference: "registerServerReference",
  /** Client-side server reference factory (RSC convention). */
  createServerReference: "createServerReference",
  /** Client-side transport function for server calls. */
  callServer: "callServer",
} as const;
