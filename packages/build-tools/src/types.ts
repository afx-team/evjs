/** Configuration for the generated server entry. */
export interface ServerEntryConfig {
  /**
   * Extra import statements to prepend to the server entry.
   * Useful for middleware, config, or side-effect imports.
   */
  setup?: string[];
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

/** Runtime identifiers used in generated code. */
export const RUNTIME = {
  /** Module paths */
  serverModule: "@evjs/runtime/server/register",
  clientTransportModule: "@evjs/runtime/client/transport",
  /** Function / property names */
  registerServerFn: "registerServerFn",
  clientCall: "__ev_call",
  clientRegister: "__ev_register",
} as const;
