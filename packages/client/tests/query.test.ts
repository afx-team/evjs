import {
  useQuery as _useQuery,
  useSuspenseQuery as _useSuspenseQuery,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery, useSuspenseQuery } from "../src/query.js";
import {
  __resetForTesting,
  callServer,
  createServerReference,
} from "../src/transport.js";

vi.mock("@tanstack/react-query", async () => ({
  useQuery: vi.fn(),
  useSuspenseQuery: vi.fn(),
}));

describe("useQuery and useSuspenseQuery wrappers", () => {
  beforeEach(() => {
    __resetForTesting();
    vi.clearAllMocks();
  });

  it("throws when passing a non-server function to useQuery", () => {
    const rawFn = async () => {};
    expect(() => useQuery(rawFn)).toThrow(
      /useQuery\(\) only accepts server functions/,
    );
  });

  it("delegates to original useQuery with queryOptions", () => {
    const getUsers = createServerReference(
      "mod:getUsers",
      callServer,
      "getUsers",
    );

    useQuery(getUsers);

    expect(_useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["mod:getUsers"],
        queryFn: expect.any(Function),
      }),
    );
  });

  it("delegates to original useSuspenseQuery with queryOptions", () => {
    const getUser = createServerReference("mod:getUser", callServer, "getUser");

    useSuspenseQuery(getUser, 42);

    expect(_useSuspenseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["mod:getUser", 42],
        queryFn: expect.any(Function),
      }),
    );
  });

  it("preserves TanStack options overload", () => {
    useQuery({ queryKey: ["test"], queryFn: async () => ({}) });
    expect(_useQuery).toHaveBeenCalledWith({
      queryKey: ["test"],
      queryFn: expect.any(Function),
    });
  });
});
