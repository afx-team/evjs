/**
 * Application-owned server function registry.
 *
 * Each server application receives its own registry instance. This keeps
 * function implementations isolated when multiple evjs apps share a process.
 */

import {
  DEFAULT_ERROR_STATUS,
  getRequestFnId,
  isHttpErrorStatus,
  isServerFunctionId,
  ServerError,
} from "@evjs/shared";
import { isRecord } from "../shared/validation.js";

/** A server function implementation. */
export type ServerFn<Args extends unknown[] = never[], Result = unknown> = (
  ...args: Args
) => Result | Promise<Result>;

/** Successful server function dispatch result. */
export interface DispatchSuccess {
  result: unknown;
}

/** Failed server function dispatch result. */
export interface DispatchError {
  error: string;
  fnId: string;
  /** HTTP-equivalent status code for the error. */
  status: number;
  /** Structured error data (if thrown via ServerError). */
  data?: unknown;
}

export type DispatchResult = DispatchSuccess | DispatchError;

declare const serverFunctionRegistryBrand: unique symbol;

/**
 * A mutable registry owned by one server application.
 *
 * `dispatch()` is exposed for custom transports such as WebSocket or IPC.
 */
export interface ServerFunctionRegistry {
  readonly [serverFunctionRegistryBrand]: true;
  register<Args extends unknown[], Result>(
    id: string,
    fn: ServerFn<Args, Result>,
  ): void;
  dispatch(id: unknown, args: unknown): Promise<DispatchResult>;
}

class ServerFunctionRegistryImpl implements ServerFunctionRegistry {
  declare readonly [serverFunctionRegistryBrand]: true;
  readonly #functions = new Map<string, ServerFn<unknown[], unknown>>();

  register<Args extends unknown[], Result>(
    id: string,
    fn: ServerFn<Args, Result>,
  ): void {
    assertServerFunctionRegistration(id, fn);
    if (this.#functions.has(id)) {
      throw new Error(
        `[evjs] serverFunctions.register() duplicate id "${id}". Server function IDs must be unique within one app.`,
      );
    }
    this.#functions.set(id, (...args) => fn(...(args as Args)));
  }

  async dispatch(id: unknown, args: unknown): Promise<DispatchResult> {
    if (!isServerFunctionId(id)) {
      return {
        error: "Missing or invalid 'fnId' in request body",
        fnId: getRequestFnId(id),
        status: 400,
      };
    }

    if (!Array.isArray(args)) {
      return {
        error: "'args' must be an array",
        fnId: id,
        status: 400,
      };
    }

    const fn = this.#functions.get(id);
    if (!fn) {
      return {
        error: `Server function "${id}" not found`,
        fnId: id,
        status: 404,
      };
    }

    try {
      const result = await fn(...args);
      return { result };
    } catch (error) {
      const serverError = getStructuredServerError(error);
      if (serverError) {
        return {
          error: serverError.message,
          fnId: id,
          status: serverError.status,
          data: serverError.data,
        };
      }
      const safeMessage = isProductionRuntime()
        ? "Internal server error"
        : formatThrownValue(error);
      return {
        error: safeMessage,
        fnId: id,
        status: DEFAULT_ERROR_STATUS,
      };
    }
  }
}

interface ServerFunctionRegistryStore {
  readonly version: 1;
  readonly instances: WeakSet<object>;
}

const SERVER_FUNCTION_REGISTRY_STORE = Symbol.for(
  "@evjs/server/server-function-registry-store/v1",
);
const serverFunctionRegistryStore = getServerFunctionRegistryStore();

/** Create an isolated registry for one server application. */
export function createServerFunctionRegistry(): ServerFunctionRegistry {
  const registry = new ServerFunctionRegistryImpl();
  serverFunctionRegistryStore.instances.add(registry);
  return Object.freeze(registry);
}

/** @internal */
export function isServerFunctionRegistry(
  value: unknown,
): value is ServerFunctionRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    serverFunctionRegistryStore.instances.has(value)
  );
}

function getServerFunctionRegistryStore(): ServerFunctionRegistryStore {
  const existing = Reflect.get(globalThis, SERVER_FUNCTION_REGISTRY_STORE) as
    | ServerFunctionRegistryStore
    | undefined;
  if (existing) {
    if (
      existing.version !== 1 ||
      !Object.isFrozen(existing) ||
      !(existing.instances instanceof WeakSet)
    ) {
      throw new Error(
        "[evjs] Server function registry store v1 is incompatible.",
      );
    }
    return existing;
  }

  const store = Object.freeze({
    version: 1 as const,
    instances: new WeakSet<object>(),
  });
  Object.defineProperty(globalThis, SERVER_FUNCTION_REGISTRY_STORE, {
    configurable: false,
    enumerable: false,
    value: store,
    writable: false,
  });
  return store;
}

function assertServerFunctionRegistration(id: string, fn: unknown): void {
  if (!isServerFunctionId(id)) {
    throw new Error(
      "[evjs] serverFunctions.register() id must be a non-empty string without leading or trailing whitespace.",
    );
  }
  if (typeof fn !== "function") {
    throw new Error("[evjs] serverFunctions.register() fn must be a function.");
  }
}

interface StructuredServerError {
  message: string;
  status: number;
  data: unknown;
}

function getStructuredServerError(
  value: unknown,
): StructuredServerError | undefined {
  if (value instanceof ServerError) {
    return {
      message: value.message,
      status: value.status,
      data: value.data,
    };
  }

  if (!isRecord(value) || value.name !== "ServerError") return undefined;
  if (typeof value.message !== "string") return undefined;
  if (!isHttpErrorStatus(value.status)) return undefined;
  return {
    message: value.message,
    status: value.status,
    data: value.data,
  };
}

function formatThrownValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    return "Unknown server function error";
  }
}

function isProductionRuntime(): boolean {
  return globalThis.process?.env?.NODE_ENV === "production";
}
