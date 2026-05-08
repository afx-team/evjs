"use server";
import { appRouter } from "../trpc";

/**
 * A Server Function that dispatches into the tRPC router.
 * This demonstrates how to combine tRPC's type-safety with
 * @evjs's RPC infrastructure.
 */
export async function trpcHandler(op: { path: string; input: unknown }) {
  const caller = appRouter.createCaller({});

  if (op.path === "hello") {
    return caller.hello();
  }

  throw new Error(`Unknown tRPC procedure: ${op.path}`);
}

// standard server function examples
export async function getServerTime() {
  return new Date().toISOString();
}
