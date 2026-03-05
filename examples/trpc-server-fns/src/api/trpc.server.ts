"use server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../trpc";

/**
 * A Server Function that acts as a tRPC handler.
 * This demonstrates how to combine tRPC's type-safety with
 * @evjs's zero-config RPC infrastructure.
 */
// biome-ignore lint/suspicious/noExplicitAny: request body
export async function trpcHandler(reqBody: any) {
  // We simulate a fetch request for tRPC
  const url = new URL("http://localhost/trpc");

  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request(url, {
      method: "POST",
      body: JSON.stringify(reqBody),
      headers: {
        "Content-Type": "application/json",
      },
    }),
    router: appRouter,
    createContext: () => ({}),
  });

  return await response.json();
}

// standard server function examples
export async function getServerTime() {
  return new Date().toISOString();
}
