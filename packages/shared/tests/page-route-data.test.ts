import { describe, expect, it } from "vitest";
import { matchPageRouteParams, parsePageSearch } from "../src/index.js";

describe("page route data helpers", () => {
  it("matches dynamic page route params from encoded pathnames", () => {
    expect(
      matchPageRouteParams(
        "/posts/$postId/comments/$commentId",
        "/posts/a%2Fb/comments/c%20d",
      ),
    ).toEqual({
      postId: "a/b",
      commentId: "c d",
    });
  });

  it("keeps malformed encoded path params readable", () => {
    expect(matchPageRouteParams("/posts/$postId", "/posts/%E0%A4%A")).toEqual({
      postId: "%E0%A4%A",
    });
  });

  it("parses page search params with repeated keys", () => {
    expect(parsePageSearch("?q=hello+world&tag=a&tag=b&empty")).toEqual({
      q: "hello world",
      tag: ["a", "b"],
      empty: "",
    });
  });
});
