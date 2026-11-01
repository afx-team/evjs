import type { RouteHandlerFn } from "@evjs/server";
import type { HttpMethod } from "@evjs/shared";
import type { Env, Input } from "hono";
import type { BlankInput } from "hono/types";

function bindHttpMethod<Method extends HttpMethod>(method: Method) {
  return function bind<
    Path extends string = string,
    E extends Env = Env,
    I extends Input = BlankInput,
  >(handler: RouteHandlerFn<Path, E, I>, options?: { path?: Path }) {
    return { ...options, method, handler };
  };
}

/** Bind a named HTTP operation without wrapping its standard Request/Response handler. */
export const http = {
  get: bindHttpMethod("GET"),
  post: bindHttpMethod("POST"),
  put: bindHttpMethod("PUT"),
  patch: bindHttpMethod("PATCH"),
  delete: bindHttpMethod("DELETE"),
  head: bindHttpMethod("HEAD"),
  options: bindHttpMethod("OPTIONS"),
};
