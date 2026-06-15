import { describe, expect, it } from "vitest";
import {
  getRscFlightClientPageUrlParam,
  resolveRscFlightRequestPageUrl,
} from "../src/index.js";

describe("RSC Flight URL helpers", () => {
  it("normalizes client page URLs to path and search", () => {
    expect(
      getRscFlightClientPageUrlParam("/dashboard?tab=stats", {
        explicit: true,
        locationHref: "https://example.com/current",
        requestUrl: new URL("https://example.com/__evjs/rsc"),
      }),
    ).toEqual({ value: "/dashboard?tab=stats" });

    expect(
      getRscFlightClientPageUrlParam(
        "https://example.com/dashboard?tab=stats",
        {
          explicit: true,
          locationHref: "https://example.com/current",
          requestUrl: new URL("https://example.com/__evjs/rsc"),
        },
      ),
    ).toEqual({ value: "/dashboard?tab=stats" });
  });

  it("uses request URL origin when browser location is not available", () => {
    expect(
      getRscFlightClientPageUrlParam(
        "https://example.com/dashboard?tab=stats",
        {
          explicit: true,
          requestUrl: new URL("https://example.com/__evjs/rsc"),
        },
      ),
    ).toEqual({ value: "/dashboard?tab=stats" });

    expect(
      getRscFlightClientPageUrlParam("https://evil.example/dashboard", {
        explicit: true,
        requestUrl: new URL("https://example.com/__evjs/rsc"),
      }),
    ).toEqual({ error: "cross-origin" });
  });

  it("classifies invalid explicit client page URLs", () => {
    const options = {
      explicit: true,
      locationHref: "https://example.com/current",
      requestUrl: new URL("https://example.com/__evjs/rsc"),
    };

    expect(getRscFlightClientPageUrlParam("", options)).toEqual({
      error: "empty-or-whitespace",
    });
    expect(getRscFlightClientPageUrlParam("dashboard", options)).toEqual({
      error: "not-absolute-path-or-url",
    });
    expect(
      getRscFlightClientPageUrlParam("javascript:alert(1)", options),
    ).toEqual({ error: "not-absolute-path-or-url" });
    expect(
      getRscFlightClientPageUrlParam("ftp://example.com/dashboard", options),
    ).toEqual({ error: "not-absolute-path-or-url" });
    expect(
      getRscFlightClientPageUrlParam("//evil.example/app", options),
    ).toEqual({ error: "not-absolute-path-or-url" });
    expect(getRscFlightClientPageUrlParam("http://[::1", options)).toEqual({
      error: "invalid-url",
    });
    expect(
      getRscFlightClientPageUrlParam("/dashboard#details", options),
    ).toEqual({ error: "hash" });
    expect(
      getRscFlightClientPageUrlParam("https://evil.example/dashboard", options),
    ).toEqual({ error: "cross-origin" });
  });

  it("ignores invalid implicit client page URLs", () => {
    expect(
      getRscFlightClientPageUrlParam("https://example.com/current", {
        explicit: false,
        requestUrl: "http://[::1",
      }),
    ).toEqual({});
  });

  it("resolves server request page URLs from query params", () => {
    const result = resolveRscFlightRequestPageUrl(
      new URL("https://example.com/__evjs/rsc?url=%2Fdashboard%3Ftab%3Dstats"),
    );

    expect(result.value).toBe("https://example.com/dashboard?tab=stats");
    expect(
      resolveRscFlightRequestPageUrl(new URL("https://example.com/__evjs/rsc")),
    ).toEqual({});
  });

  it("classifies invalid server request page URLs", () => {
    expect(
      resolveRscFlightRequestPageUrl(
        new URL("https://example.com/__evjs/rsc?url=dashboard"),
      ),
    ).toEqual({ error: "not-absolute-path" });
    expect(
      resolveRscFlightRequestPageUrl(
        new URL(
          "https://example.com/__evjs/rsc?url=https%3A%2F%2Fevil.example%2Fdashboard",
        ),
      ),
    ).toEqual({ error: "not-absolute-path" });
    expect(
      resolveRscFlightRequestPageUrl(
        new URL("https://example.com/__evjs/rsc?url=%2F%2Fevil.example%2Fapp"),
      ),
    ).toEqual({ error: "not-absolute-path" });
    expect(
      resolveRscFlightRequestPageUrl(
        new URL("https://example.com/__evjs/rsc?url=%2Fdashboard%23details"),
      ),
    ).toEqual({ error: "cross-origin-or-hash" });
  });
});
