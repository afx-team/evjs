import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { serverFn } from "../src/query.js";
import {
  __fn_register,
  __resetForTesting,
  initTransport,
} from "../src/transport.js";

describe("serverFn", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("generates queryKey from fnId", () => {
    const myFn = async () => [];
    __fn_register(myFn, "mod:getUsers", "getUsers");

    const opts = serverFn(myFn);
    expect(opts.queryKey).toEqual(["mod:getUsers"]);
  });

  it("includes args in queryKey", () => {
    const myFn = async (_id: string) => ({});
    __fn_register(myFn, "mod:getUser", "getUser");

    const opts = serverFn(myFn, "abc");
    expect(opts.queryKey).toEqual(["mod:getUser", "abc"]);
  });

  it("uses __fn_call for RPC transport", async () => {
    const send = vi.fn().mockResolvedValue([{ id: 1 }]);
    initTransport({ transport: { send } });

    const myFn = async () => [];
    __fn_register(myFn, "mod:getUsers", "getUsers");

    const opts = serverFn(myFn);
    const result = await opts.queryFn({
      signal: undefined as unknown as AbortSignal,
    });

    expect(send).toHaveBeenCalledWith("mod:getUsers", [], {
      signal: undefined,
    });
    expect(result).toEqual([{ id: 1 }]);
  });

  it("throws for non-server functions", () => {
    const rawFn = vi.fn().mockResolvedValue({});
    expect(() => serverFn(rawFn)).toThrow(
      /serverFn\(\) only accepts server functions/,
    );
  });

  it("fn.queryKey() matches serverFn(fn).queryKey", () => {
    const getUsers = async () => [];
    __fn_register(getUsers, "mod:getUsers", "getUsers");

    const sfn = getUsers as unknown as {
      queryKey: (...args: unknown[]) => unknown[];
    };
    expect(sfn.queryKey()).toEqual(serverFn(getUsers).queryKey);
  });

  it("fn.queryKey(arg) matches serverFn(fn, arg).queryKey", () => {
    const getUser = async (_id: string) => ({});
    __fn_register(getUser, "mod:getUser", "getUser");

    const sfn = getUser as unknown as {
      queryKey: (...args: unknown[]) => unknown[];
    };
    expect(sfn.queryKey("abc")).toEqual(serverFn(getUser, "abc").queryKey);
  });

  // ── Type-safety assertions ──

  it("infers TData from server function return type", () => {
    type User = { id: number; name: string };
    const getUsers = async () => [] as User[];
    __fn_register(getUsers, "mod:getUsers", "getUsers");

    const opts = serverFn(getUsers);
    expectTypeOf(opts.queryKey).toEqualTypeOf<unknown[]>();
    expectTypeOf(opts.queryFn).returns.resolves.toEqualTypeOf<User[]>();
  });

  it("infers TData for single-arg server functions", () => {
    type User = { id: number; name: string };
    const getUser = async (_id: string) => ({}) as User;
    __fn_register(getUser, "mod:getUser", "getUser");

    const opts = serverFn(getUser, "abc");
    expectTypeOf(opts.queryFn).returns.resolves.toEqualTypeOf<User>();
  });

  it("infers TData for multi-arg server functions", () => {
    type SearchResult = { id: number; name: string };
    const searchUsers = async (_name: string, _email: string) =>
      [] as SearchResult[];
    __fn_register(searchUsers, "mod:searchUsers", "searchUsers");

    const opts = serverFn(searchUsers, "alice", "alice@test.com");
    expectTypeOf(opts.queryFn).returns.resolves.toEqualTypeOf<SearchResult[]>();
  });

  it("is assignable to useQuery options (TData flows through)", () => {
    type Post = { id: string; title: string };
    const getPosts = async () => [] as Post[];
    __fn_register(getPosts, "mod:getPosts", "getPosts");

    // Simulate what useQuery sees: it receives { queryKey, queryFn }
    // and infers TData from queryFn's return type
    const opts = serverFn(getPosts);

    // This is what useQuery internally resolves:
    type InferredData = Awaited<ReturnType<typeof opts.queryFn>>;
    expectTypeOf<InferredData>().toEqualTypeOf<Post[]>();

    // Spread into useQuery options should preserve types
    const extended = { ...opts, staleTime: 5000 };
    type ExtendedData = Awaited<ReturnType<typeof extended.queryFn>>;
    expectTypeOf<ExtendedData>().toEqualTypeOf<Post[]>();
  });

  it("enforces correct arg types from server function signature", () => {
    const getUser = async (_id: number, _includeDeleted: boolean) =>
      ({}) as { name: string };
    __fn_register(getUser, "mod:getUser", "getUser");

    // Correct args
    const opts = serverFn(getUser, 42, true);
    expectTypeOf(opts.queryFn).returns.resolves.toEqualTypeOf<{
      name: string;
    }>();

    // @ts-expect-error — wrong arg type (string instead of number)
    serverFn(getUser, "wrong", true);

    // @ts-expect-error — missing second arg
    serverFn(getUser, 42);
  });
});

describe("useQuery overload types", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("infers TData when called with server function", () => {
    type User = { id: number; name: string };
    const getUsers = async () => [] as User[];
    __fn_register(getUsers, "mod:getUsers", "getUsers");

    // useQuery(getUsers) should produce UseQueryResult<User[]>
    // We can only test the type at compile time, not runtime (hook requires React)
    type Opts = ReturnType<typeof serverFn<[], User[]>>;
    expectTypeOf<Opts["queryFn"]>().returns.resolves.toEqualTypeOf<User[]>();
  });

  it("infers TData for multi-arg server function via useQuery", () => {
    type SearchResult = { id: number; name: string };
    const search = async (_q: string, _page: number) => [] as SearchResult[];
    __fn_register(search, "mod:search", "search");

    const opts = serverFn(search, "test", 1);
    expectTypeOf(opts.queryFn).returns.resolves.toEqualTypeOf<SearchResult[]>();
  });
});
