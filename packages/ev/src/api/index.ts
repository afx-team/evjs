import type { RouteHandlerDescriptor } from "@evjs/server";
import type { HttpMethod } from "@evjs/shared";

/** HTTP method handlers and composition for file-convention applications. */
export type { RouteHandlerDescriptor, RouteHandlerFn } from "@evjs/server";
export { withMiddlewares } from "@evjs/server";

export type { HttpMethod } from "@evjs/shared";

/** A method and a path suffix relative to a http.* domain directory. */
export interface HttpRouteMetadata<Path extends string = string> {
  method: HttpMethod;
  path?: Path;
}

/** Typed HTTP operation declared by one named export in a domain module. */
export type HttpOperation<Path extends string = string> =
  RouteHandlerDescriptor<Path> & HttpRouteMetadata<Path>;
