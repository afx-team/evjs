import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { serverFn } from "../src/client/hooks.js";
import {
  __fn_register,
  __resetForTesting,
  initTransport,
} from "../src/client/transport.js";

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
});
