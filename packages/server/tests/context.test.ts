import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  cookies,
  getContext,
  headers,
  request,
  waitUntil,
} from "../src/context.js";
import { registerServerReference } from "../src/functions/index.js";

describe("Server Request Context", () => {
  it("should throw when used outside a request lifecycle", () => {
    expect(() => getContext()).toThrow();
    expect(() => request()).toThrow();
    expect(() => headers()).toThrow();
    expect(() => cookies()).toThrow();
  });

  it("should provide context inside a server function", async () => {
    // 1. Create a server function that uses the context
    async function myServerFn() {
      const req = request();
      const hdrs = headers();
      const ctx = getContext();
      const cks = cookies();

      expect(req).toBe(ctx.req.raw);

      waitUntil(new Promise((resolve) => setTimeout(resolve, 0)));
      cks.set("newcookie", "tasty", { maxAge: 1000 });
      cks.delete("oldcookie");

      // Return a value derived from headers and cookies to verify it works
      return {
        hdr: hdrs.get("x-custom-test"),
        cookie: cks.get("testcookie"),
      };
    }

    // 2. Register it so dispatch() can find it
    registerServerReference(myServerFn, "myServerFn");

    // 3. Create the app and perform a test request
    const app = createApp();

    const reqbody = JSON.stringify({ fnId: "myServerFn", args: [] });
    const response = await app.request("/api/fn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-custom-test": "it-works",
        cookie: "testcookie=yummy; othercookie=chocolate",
      },
      body: reqbody,
    });

    // Check outgoing cookies
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^newcookie=tasty; Max-Age=1000/),
        expect.stringMatching(/^oldcookie=; Max-Age=0/),
      ]),
    );

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      result: { hdr: string; cookie: string };
    };
    expect(json.result.hdr).toBe("it-works");
    expect(json.result.cookie).toBe("yummy");
  });
});
