import { describe, expect, it } from "vitest";
import {
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
} from "../src/index.js";

describe("HTTP helpers", () => {
  it("exposes a stable supported method description for diagnostics", () => {
    expect(HTTP_METHOD_LIST_DESCRIPTION).toBe(HTTP_METHODS.join(", "));
    expect(HTTP_METHOD_LIST_DESCRIPTION).toBe(
      "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    );
  });

  it("exposes canonical HTTP media types for diagnostics", () => {
    expect(APPLICATION_JSON_CONTENT_TYPE).toBe("application/json");
    expect(TEXT_HTML_CONTENT_TYPE).toBe("text/html");
    expect(TEXT_PLAIN_CONTENT_TYPE).toBe("text/plain");
    expect(RSC_FLIGHT_CONTENT_TYPE).toBe("text/x-component");
    expect(TEXT_HTML_UTF8_CONTENT_TYPE).toBe("text/html; charset=utf-8");
    expect(TEXT_PLAIN_UTF8_CONTENT_TYPE).toBe("text/plain; charset=utf-8");
  });

  it("classifies and normalizes supported HTTP methods", () => {
    expect(isHttpMethod("GET")).toBe(true);
    expect(isHttpMethod("get")).toBe(false);
    expect(toHttpMethod("patch")).toBe("PATCH");
    expect(toHttpMethod("TRACE")).toBeUndefined();
  });

  it("classifies HTTP error status codes", () => {
    expect(isHttpErrorStatus(400)).toBe(true);
    expect(isHttpErrorStatus(500)).toBe(true);
    expect(isHttpErrorStatus(599)).toBe(true);
    expect(isHttpErrorStatus(399)).toBe(false);
    expect(isHttpErrorStatus(600)).toBe(false);
    expect(isHttpErrorStatus(500.5)).toBe(false);
    expect(isHttpErrorStatus("500")).toBe(false);
  });

  it("classifies HTTP status codes that can include a body", () => {
    expect(isHttpBodyStatus(200)).toBe(true);
    expect(isHttpBodyStatus(418)).toBe(true);
    expect(isHttpBodyStatus(599)).toBe(true);
    expect(isHttpBodyStatus(199)).toBe(false);
    expect(isHttpBodyStatus(204)).toBe(false);
    expect(isHttpBodyStatus(205)).toBe(false);
    expect(isHttpBodyStatus(304)).toBe(false);
    expect(isHttpBodyStatus(600)).toBe(false);
    expect(isHttpBodyStatus(200.5)).toBe(false);
    expect(isHttpBodyStatus("200")).toBe(false);
  });

  it("classifies HeadersInit-compatible values", () => {
    expect(isHeadersInit({ "x-evjs": "yes" })).toBe(true);
    expect(isHeadersInit([["x-evjs", "yes"]])).toBe(true);
    expect(isHeadersInit(new Headers({ "x-evjs": "yes" }))).toBe(true);
    expect(isHeadersInit(null)).toBe(false);
    expect(isHeadersInit(42)).toBe(false);
    expect(isHeadersInit([["x-evjs"]])).toBe(false);
  });

  it("classifies exact application/json content types", () => {
    expect(isApplicationJsonContentType(APPLICATION_JSON_CONTENT_TYPE)).toBe(
      true,
    );
    expect(
      isApplicationJsonContentType("Application/JSON; charset=utf-8"),
    ).toBe(true);
    expect(isApplicationJsonContentType(" application/json ")).toBe(true);
    expect(isApplicationJsonContentType("text/application/json")).toBe(false);
    expect(isApplicationJsonContentType("application/json-patch+json")).toBe(
      false,
    );
    expect(isApplicationJsonContentType("application/vnd.evjs+json")).toBe(
      false,
    );
    expect(isApplicationJsonContentType("")).toBe(false);
    expect(isApplicationJsonContentType(null)).toBe(false);
  });

  it("formats Content-Type header values for diagnostics", () => {
    expect(formatContentTypeHeaderValue("text/html")).toBe('"text/html"');
    expect(formatContentTypeHeaderValue(null)).toBe("missing Content-Type");
  });

  it("classifies exact text/html content types", () => {
    expect(isTextHtmlContentType(TEXT_HTML_CONTENT_TYPE)).toBe(true);
    expect(isTextHtmlContentType("Text/HTML; charset=utf-8")).toBe(true);
    expect(isTextHtmlContentType(" text/html ")).toBe(true);
    expect(isTextHtmlContentType("application/text/html")).toBe(false);
    expect(isTextHtmlContentType("text/html+evjs")).toBe(false);
    expect(isTextHtmlContentType("")).toBe(false);
    expect(isTextHtmlContentType(null)).toBe(false);
  });

  it("classifies exact RSC Flight content types", () => {
    expect(isRscFlightContentType(RSC_FLIGHT_CONTENT_TYPE)).toBe(true);
    expect(isRscFlightContentType("Text/X-Component; charset=utf-8")).toBe(
      true,
    );
    expect(isRscFlightContentType(" text/x-component ")).toBe(true);
    expect(isRscFlightContentType("application/text/x-component")).toBe(false);
    expect(isRscFlightContentType("text/x-component+json")).toBe(false);
    expect(isRscFlightContentType("")).toBe(false);
    expect(isRscFlightContentType(null)).toBe(false);
  });
});
