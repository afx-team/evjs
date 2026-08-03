import { afterEach, describe, expect, it } from "vitest";
import { serve } from "../src/runtimes/node.js";

type NodeRuntimeServer = ReturnType<typeof serve>;

const originalPort = process.env.PORT;

afterEach(() => {
  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }
});

describe("Node runtime", () => {
  it("honors port 0 and releases process signal handlers on close", async () => {
    process.env.PORT = "65536";
    const sigtermListeners = process.listenerCount("SIGTERM");
    const sigintListeners = process.listenerCount("SIGINT");
    const server = serve(
      { fetch: () => new Response("ok") },
      { host: "127.0.0.1", port: 0 },
    );

    try {
      await waitForListening(server);
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).toBe("object");
      if (!address || typeof address === "string") {
        throw new Error("Expected a TCP server address.");
      }
      expect(address.port).toBeGreaterThan(0);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners + 1);
    } finally {
      await closeServer(server);
    }

    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
  });

  it("rejects invalid option and environment ports before listening", () => {
    const app = { fetch: () => new Response("ok") };
    expect(() => serve(app, { port: -1 })).toThrow(
      "options.port must be an integer TCP port from 0 to 65535",
    );

    process.env.PORT = "not-a-port";
    expect(() => serve(app)).toThrow(
      "process.env.PORT must be an integer TCP port from 0 to 65535",
    );
    process.env.PORT = "1e3";
    expect(() => serve(app)).toThrow(
      "process.env.PORT must be an integer TCP port from 0 to 65535",
    );
  });
});

async function waitForListening(server: NodeRuntimeServer): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

async function closeServer(server: NodeRuntimeServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
