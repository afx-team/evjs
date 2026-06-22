import {
  useMutation as _useMutation,
  useQuery as _useQuery,
  useSuspenseQuery as _useSuspenseQuery,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFnQueryKey,
  getFnQueryOptions,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "../src/query.js";
import {
  __resetForTesting,
  createServerReference,
  initTransport,
} from "../src/transport-runtime.js";

vi.mock("@tanstack/react-query", async () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useSuspenseQuery: vi.fn(),
}));

describe("useQuery and useSuspenseQuery wrappers", () => {
  beforeEach(() => {
    __resetForTesting();
    vi.clearAllMocks();
  });

  it("reports anonymous non-server functions passed to useQuery", () => {
    expect(() => useQuery(async () => {})).toThrow(
      '[evjs] useQuery() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch. Received an anonymous function.',
    );
  });

  it("throws when passing non-server functions to server function hook overloads", () => {
    const rawFn = async () => "ok";

    expect(() => useQuery(rawFn)).toThrow(
      '[evjs] useQuery() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch. Received function "rawFn".',
    );
    expect(() => useSuspenseQuery(rawFn)).toThrow(
      '[evjs] useSuspenseQuery() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch. Received function "rawFn".',
    );
    expect(() => useMutation(rawFn)).toThrow(
      '[evjs] useMutation() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch. Received function "rawFn".',
    );
  });

  it("delegates to original useQuery with queryOptions", () => {
    const getUsers = createServerReference("mod:getUsers", "getUsers");

    useQuery(getUsers);

    expect(_useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["mod:getUsers"],
        queryFn: expect.any(Function),
      }),
    );
  });

  it("delegates to original useSuspenseQuery with queryOptions", () => {
    const getUser = createServerReference("mod:getUser", "getUser");

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

  it("returns query keys for direct server function helper usage", () => {
    const getUser = createServerReference("mod:getUser", "getUser") as (
      id: string,
    ) => Promise<{ id: string }>;

    expect(getFnQueryKey(getUser, "42")).toEqual(["mod:getUser", "42"]);
  });

  it("returns query options that call the server function transport", async () => {
    const send = vi.fn().mockResolvedValue({ id: "42" });
    initTransport({ adapter: { send } });
    const getUser = createServerReference("mod:getUser", "getUser") as (
      id: string,
    ) => Promise<{ id: string }>;

    const signal = new AbortController().signal;
    const options = getFnQueryOptions(getUser, "42");

    expect(options.queryKey).toEqual(["mod:getUser", "42"]);
    await expect(options.queryFn({ signal })).resolves.toEqual({ id: "42" });
    expect(send).toHaveBeenCalledWith(
      "mod:getUser",
      ["42"],
      expect.objectContaining({ signal }),
    );
  });

  it("throws when direct query helpers receive non-server functions", () => {
    const rawFn = async () => "ok";

    expect(() => getFnQueryKey(rawFn)).toThrow(
      '[evjs] getFnQueryKey() only accepts compiler-generated server function stubs. Plain functions do not carry the server-boundary metadata required for query keys. Received function "rawFn".',
    );
    expect(() => getFnQueryOptions(rawFn)).toThrow(
      '[evjs] getFnQueryOptions() only accepts compiler-generated server function stubs. Plain functions do not carry the server-boundary metadata required for query options. Received function "rawFn".',
    );
  });

  it("rejects invalid server mutation options", () => {
    const refresh = createServerReference("mod:refresh", "refresh", 0);

    expect(() => useMutation(refresh, null as never)).toThrow(
      "[evjs] useMutation() server function options must be an object when provided.",
    );
    expect(() => useMutation(refresh, [] as never)).toThrow(
      "[evjs] useMutation() server function options must be an object when provided.",
    );
    expect(() =>
      useMutation(refresh, { mutationFn: async () => "override" } as never),
    ).toThrow(
      "[evjs] useMutation() server function options must not include mutationFn. Pass the server function as the first argument instead.",
    );
    expect(_useMutation).not.toHaveBeenCalled();
  });

  it("serializes no-argument server mutations as empty args", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const refresh = createServerReference("mod:refresh", "refresh", 0);

    useMutation(refresh);

    const options = vi.mocked(_useMutation).mock.calls[0]?.[0] as {
      mutationFn: (variables?: unknown) => Promise<unknown>;
    };
    await expect(options.mutationFn()).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith("mod:refresh", [], undefined);
  });

  it("treats omitted variables as empty args for arity-less mutation stubs", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const refresh = createServerReference("mod:refresh", "refresh");

    useMutation(refresh);

    const options = vi.mocked(_useMutation).mock.calls[0]?.[0] as {
      mutationFn: (variables?: unknown) => Promise<unknown>;
    };
    await expect(options.mutationFn()).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith("mod:refresh", [], undefined);
  });

  it("treats tuple variables as multiple args for arity-less mutation stubs", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const searchUsers = createServerReference("mod:search", "searchUsers");

    useMutation(searchUsers);

    const options = vi.mocked(_useMutation).mock.calls[0]?.[0] as {
      mutationFn: (variables: unknown) => Promise<unknown>;
    };
    await expect(options.mutationFn(["Ada", { active: true }])).resolves.toBe(
      "ok",
    );
    expect(send).toHaveBeenCalledWith(
      "mod:search",
      ["Ada", { active: true }],
      undefined,
    );
  });

  it("preserves array values for single-argument server mutations", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const saveRoles = createServerReference("mod:saveRoles", "saveRoles", 1);

    useMutation(saveRoles);

    const options = vi.mocked(_useMutation).mock.calls[0]?.[0] as {
      mutationFn: (variables: unknown) => Promise<unknown>;
    };
    await expect(options.mutationFn(["admin", "editor"])).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith(
      "mod:saveRoles",
      [["admin", "editor"]],
      undefined,
    );
  });

  it("requires tuple variables for multi-argument server mutations", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const inviteUser = createServerReference("mod:inviteUser", "inviteUser", 2);

    useMutation(inviteUser);

    const options = vi.mocked(_useMutation).mock.calls[0]?.[0] as {
      mutationFn: (variables: unknown) => Promise<unknown>;
    };
    expect(() => options.mutationFn("Ada")).toThrow(
      '[evjs] useMutation() server function "inviteUser" expects 2 arguments. Pass mutation variables as a tuple array.',
    );
    expect(() => options.mutationFn(["Ada"])).toThrow(
      '[evjs] useMutation() server function "inviteUser" expects 2 arguments but received 1.',
    );
    await expect(options.mutationFn(["Ada", "ada@example.com"])).resolves.toBe(
      "ok",
    );
    expect(send).toHaveBeenCalledWith(
      "mod:inviteUser",
      ["Ada", "ada@example.com"],
      undefined,
    );
  });
});
