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
 * Module identifiers used by server-function transforms.
 *
 * These are build-time constants for generated `"use server"` code. Runtime
 * URLs and browser-facing origins live in config/manifest runtime fields.
 */
export const SERVER_FUNCTION_TRANSFORM_RUNTIME = {
  /** Module path for server-side function registration (no Hono dependency). */
  serverModule: "@evjs/server/register",
  /** Module path for generated client-side server reference stubs. */
  clientModule: "@evjs/client/internal/server-functions",
  /** Server-side function registration (RSC convention). */
  registerServerReference: "registerServerReference",
  /** Client-side server reference factory (RSC convention). */
  createServerReference: "createServerReference",
} as const;
