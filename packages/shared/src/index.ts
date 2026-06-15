/**
 * @evjs/shared — runtime types and utilities shared by @evjs/client and @evjs/server.
 */

export {
  BUILD_IDENTIFIER_DESCRIPTION,
  isBuildIdentifier,
} from "./build-identifier.js";
export {
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
  DEFAULT_SERVER_BASE_PATH,
  getFunctionEndpoint,
} from "./constants.js";
export { ServerError, ServerFunctionError } from "./errors.js";
export type { HttpMethod } from "./http.js";
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
} from "./http.js";
export type {
  PageRouteParamNameValidationError,
  PageRouteParamSegmentValidationError,
  PageRouteParamSegmentValidationErrorKind,
  PageSearchParams,
} from "./page-route-data.js";
export {
  findBestPageRoute,
  getPageRouteParamNameValidationError,
  getPageRouteParamSegmentValidationError,
  isReservedPageRouteParamName,
  matchPageRouteParams,
  normalizeRoutePathname,
  pageRoutePathMatches,
  pageRoutePathShapeFromPath,
  parsePageSearch,
} from "./page-route-data.js";
export type {
  PathPatternListValidationError,
  PathPatternListValidationOptions,
  PathPatternMatch,
  PathPatternValidationError,
} from "./path-pattern.js";
export {
  comparePathPatternMatches,
  findBestPathPatternMatch,
  getPathPatternListValidationError,
  getPathPatternValidationError,
  isPathPattern,
  pathPatternMatches,
} from "./path-pattern.js";
export type {
  RscFlightClientPageUrlParamError,
  RscFlightClientPageUrlParamOptions,
  RscFlightClientPageUrlParamResult,
  RscFlightRequestPageUrlError,
  RscFlightRequestPageUrlResult,
  RscFlightRequestUrl,
  RscFlightUrlBase,
} from "./rsc-flight-url.js";
export {
  getRscFlightClientPageUrlParam,
  resolveRscFlightRequestPageUrl,
} from "./rsc-flight-url.js";
export {
  assertServerFunctionExportName,
  assertServerFunctionId,
  getRequestFnId,
  isServerFunctionExportName,
  isServerFunctionId,
} from "./server-function-id.js";
export type {
  ServerRouteParamNameValidationError,
  ServerRouteParamSegmentValidationError,
  ServerRouteParamSegmentValidationErrorKind,
} from "./server-route-data.js";
export {
  getServerRouteParamNameValidationError,
  getServerRouteParamSegmentValidationError,
  isReservedServerRouteParamName,
  serverRoutePathShapeFromPath,
} from "./server-route-data.js";
export type { SharedVersionRangeValidationError } from "./shared-version-range.js";
export {
  getSharedVersionRangeValidationError,
  isSharedVersionRange,
  SHARED_VERSION_RANGE_DESCRIPTION,
} from "./shared-version-range.js";
export type {
  AbsoluteHttpUrlValidationError,
  HttpUrlOrAbsolutePathnameValidationError,
  HttpUrlOrPathValidationError,
  UrlObjectValidationBase,
  UrlStringValidationError,
  UrlStringValidationOptions,
  UrlValidationBase,
} from "./url-validation.js";
export {
  getAbsoluteHttpUrlValidationError,
  getHttpUrlOrAbsolutePathnameValidationError,
  getHttpUrlOrPathValidationError,
  getUrlStringValidationError,
} from "./url-validation.js";
