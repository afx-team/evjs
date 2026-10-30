/**
 * @evjs/shared — runtime types and utilities shared by @evjs/client and @evjs/server.
 */

export { resolveBrowserAssetHref } from "./assets/browser-url.js";
export {
  BUILD_IDENTIFIER_DESCRIPTION,
  isBuildIdentifier,
} from "./build/identifier.js";
export type { HttpMethod } from "./http/index.js";
export {
  APPLICATION_JSON_CONTENT_TYPE,
  formatContentTypeHeaderValue,
  HTTP_METHOD_LIST_DESCRIPTION,
  HTTP_METHODS,
  isApplicationJsonContentType,
  isHeadersInit,
  isHttpBodyStatus,
  isHttpErrorStatus,
  isHttpMethod,
  isRscFlightContentType,
  isTextHtmlContentType,
  RSC_FLIGHT_CONTENT_TYPE,
  TEXT_HTML_CONTENT_TYPE,
  TEXT_HTML_UTF8_CONTENT_TYPE,
  TEXT_PLAIN_CONTENT_TYPE,
  TEXT_PLAIN_UTF8_CONTENT_TYPE,
  toHttpMethod,
} from "./http/index.js";
export type {
  PageRouteParamNameValidationError,
  PageRouteParamSegmentValidationError,
  PageRouteParamSegmentValidationErrorKind,
  PageSearchParams,
} from "./routing/page-route.js";
export {
  findBestPageRoute,
  getPageRouteParamNameValidationError,
  getPageRouteParamSegmentValidationError,
  isReservedPageRouteParamName,
  matchPageRouteParams,
  normalizeRoutePathname,
  pageRoutePathMatches,
  pageRoutePathShapeFromPath,
  pageRoutePathToRegExp,
  parsePageSearch,
} from "./routing/page-route.js";
export type {
  PathPatternListValidationError,
  PathPatternListValidationOptions,
  PathPatternMatch,
  PathPatternValidationError,
} from "./routing/path-pattern.js";
export {
  comparePathPatternMatches,
  findBestPathPatternMatch,
  getPathPatternListValidationError,
  getPathPatternValidationError,
  isPathPattern,
  pathPatternMatches,
} from "./routing/path-pattern.js";
export {
  isDotRouteSegment,
  staticRouteSegmentsEqual,
} from "./routing/segment.js";
export type {
  ServerRouteParamNameValidationError,
  ServerRouteParamSegmentValidationError,
  ServerRouteParamSegmentValidationErrorKind,
} from "./routing/server-route.js";
export {
  getServerRouteParamNameValidationError,
  getServerRouteParamSegmentValidationError,
  isReservedServerRouteParamName,
  serverRoutePathShapeFromPath,
} from "./routing/server-route.js";
export { compareRoutePathsBySpecificity } from "./routing/specificity.js";
export type {
  RscFlightClientPageUrlParamError,
  RscFlightClientPageUrlParamOptions,
  RscFlightClientPageUrlParamResult,
  RscFlightRequestPageUrlError,
  RscFlightRequestPageUrlResult,
  RscFlightRequestUrl,
  RscFlightUrlBase,
} from "./rsc/flight-url.js";
export {
  getRscFlightClientPageUrlParam,
  resolveRscFlightRequestPageUrl,
} from "./rsc/flight-url.js";
export {
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
  DEFAULT_SERVER_BASE_PATH,
  getFunctionEndpoint,
} from "./runtime/constants.js";
export { ServerError, ServerFunctionError } from "./runtime/errors.js";
export type { ConcreteRuntimePathSegmentValidationError } from "./runtime/path.js";
export {
  formatConcreteRuntimePathSegmentValidationError,
  getConcreteRuntimePathSegmentValidationError,
} from "./runtime/path.js";
export {
  assertServerFunctionExportName,
  assertServerFunctionId,
  getRequestFnId,
  isServerFunctionExportName,
  isServerFunctionId,
} from "./server-functions/id.js";
export type {
  AbsoluteHttpUrlValidationError,
  HttpUrlOrAbsolutePathnameValidationError,
  HttpUrlOrPathValidationError,
  UrlObjectValidationBase,
  UrlStringValidationError,
  UrlStringValidationOptions,
  UrlValidationBase,
} from "./urls/validation.js";
export {
  getAbsoluteHttpUrlValidationError,
  getHttpUrlOrAbsolutePathnameValidationError,
  getHttpUrlOrPathValidationError,
  getUrlStringValidationError,
} from "./urls/validation.js";
