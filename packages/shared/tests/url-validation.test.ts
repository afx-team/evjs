import { describe, expect, it } from "vitest";
import {
  getAbsoluteHttpUrlValidationError,
  getHttpUrlOrAbsolutePathnameValidationError,
  getHttpUrlOrPathValidationError,
  getUrlStringValidationError,
} from "../src/index.js";

describe("URL validation helpers", () => {
  it("classifies URL strings that can resolve against a base URL", () => {
    const baseUrl = new URL("https://example.com/app/");

    expect(getUrlStringValidationError("/api", { baseUrl })).toBeUndefined();
    expect(
      getUrlStringValidationError("https://api.example.com", { baseUrl }),
    ).toBeUndefined();
    expect(getUrlStringValidationError("", { baseUrl })).toBe("empty");
    expect(getUrlStringValidationError(null, { baseUrl })).toBe("empty");
    expect(getUrlStringValidationError(" /api", { baseUrl })).toBe(
      "whitespace",
    );
    expect(getUrlStringValidationError("http://[::1", { baseUrl })).toBe(
      "invalid-url",
    );
  });

  it("classifies absolute HTTP(S) URLs", () => {
    expect(
      getAbsoluteHttpUrlValidationError("https://api.example.com"),
    ).toBeUndefined();
    expect(
      getAbsoluteHttpUrlValidationError("http://localhost:4000"),
    ).toBeUndefined();
    expect(getAbsoluteHttpUrlValidationError("")).toBe("empty");
    expect(getAbsoluteHttpUrlValidationError(undefined)).toBe("empty");
    expect(getAbsoluteHttpUrlValidationError(" https://api.example.com")).toBe(
      "whitespace",
    );
    expect(getAbsoluteHttpUrlValidationError("/api")).toBe(
      "not-absolute-http-url",
    );
    expect(getAbsoluteHttpUrlValidationError("ws://api.example.com")).toBe(
      "not-absolute-http-url",
    );
    expect(getAbsoluteHttpUrlValidationError("http://[::1")).toBe(
      "not-absolute-http-url",
    );
  });

  it("classifies HTTP(S) URLs and URL-resolvable paths", () => {
    expect(
      getHttpUrlOrPathValidationError("https://assets.example.com/app.json"),
    ).toBeUndefined();
    expect(getHttpUrlOrPathValidationError("/assets/app.json")).toBeUndefined();
    expect(getHttpUrlOrPathValidationError("assets/app.json")).toBeUndefined();
    expect(getHttpUrlOrPathValidationError("")).toBe("empty");
    expect(getHttpUrlOrPathValidationError(undefined)).toBe("empty");
    expect(getHttpUrlOrPathValidationError(" /assets/app.json")).toBe(
      "whitespace",
    );
    expect(getHttpUrlOrPathValidationError("http://[::1")).toBe(
      "not-http-url-or-path",
    );
    expect(getHttpUrlOrPathValidationError("javascript:alert(1)")).toBe(
      "not-http-url-or-path",
    );
  });

  it("classifies HTTP(S) URLs and absolute pathnames", () => {
    expect(
      getHttpUrlOrAbsolutePathnameValidationError(
        "https://example.com/crm/customers",
      ),
    ).toBeUndefined();
    expect(
      getHttpUrlOrAbsolutePathnameValidationError("/crm/customers"),
    ).toBeUndefined();
    expect(
      getHttpUrlOrAbsolutePathnameValidationError(
        new URL("https://example.com/crm/customers"),
      ),
    ).toBeUndefined();
    expect(getHttpUrlOrAbsolutePathnameValidationError("")).toBe("empty");
    expect(getHttpUrlOrAbsolutePathnameValidationError(null)).toBe("empty");
    expect(getHttpUrlOrAbsolutePathnameValidationError(" /crm")).toBe(
      "whitespace",
    );
    expect(getHttpUrlOrAbsolutePathnameValidationError("crm/customers")).toBe(
      "not-http-url-or-absolute-pathname",
    );
    expect(
      getHttpUrlOrAbsolutePathnameValidationError(
        new URL("ftp://example.com/crm"),
      ),
    ).toBe("not-http-url-or-absolute-pathname");
  });
});
