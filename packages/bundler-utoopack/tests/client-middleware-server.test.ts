import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reserveEphemeralPort,
  startClientMiddlewareServer,
} from "../src/adapter/client-middleware-server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup()),
  );
});

describe("Utoopack client middleware server", () => {
  it("runs middleware in order before forwarding to Utoopack", async () => {
    const upstream = http.createServer((_request, response) => {
      response.end("upstream");
    });
    await listen(upstream);
    cleanups.push(() => close(upstream));
    const upstreamAddress = upstream.address() as AddressInfo;
    const events: string[] = [];
    const port = await reserveEphemeralPort();
    const abortController = new AbortController();
    const server = await startClientMiddlewareServer({
      cwd: process.cwd(),
      port,
      https: false,
      signal: abortController.signal,
      upstream: { hostname: "127.0.0.1", port: upstreamAddress.port },
      middlewares: [
        async (_request, _response, next, context) => {
          events.push(`first:${context.origin}`);
          expect(context.signal).toBe(abortController.signal);
          await next();
          events.push("first:after");
        },
        async (request, response, next) => {
          events.push("second");
          if (request.url === "/handled") {
            response.end("handled");
            return;
          }
          await next();
        },
      ],
    });
    cleanups.push(() => server.close());

    await expect(
      fetch(`${server.origin}/handled`).then((result) => result.text()),
    ).resolves.toBe("handled");
    await expect(
      fetch(`${server.origin}/asset.js`).then((result) => result.text()),
    ).resolves.toBe("upstream");
    expect(events).toEqual([
      `first:${server.origin}`,
      "second",
      "first:after",
      `first:${server.origin}`,
      "second",
      "first:after",
    ]);
  });

  it("turns asynchronous middleware failures into diagnostic responses", async () => {
    const upstream = http.createServer();
    await listen(upstream);
    cleanups.push(() => close(upstream));
    const upstreamAddress = upstream.address() as AddressInfo;
    const server = await startClientMiddlewareServer({
      cwd: process.cwd(),
      port: await reserveEphemeralPort(),
      https: false,
      signal: new AbortController().signal,
      upstream: { hostname: "127.0.0.1", port: upstreamAddress.port },
      middlewares: [
        async () => {
          await Promise.resolve();
          throw new Error("middleware exploded");
        },
      ],
    });
    cleanups.push(() => server.close());

    const response = await fetch(server.origin);
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain("middleware exploded");
  });

  it("bypasses middleware for HMR and other WebSocket upgrades", async () => {
    const upstream = http.createServer();
    upstream.on("upgrade", (_request, socket) => {
      socket.end(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
    });
    await listen(upstream);
    cleanups.push(() => close(upstream));
    const upstreamAddress = upstream.address() as AddressInfo;
    const middleware = vi.fn();
    const server = await startClientMiddlewareServer({
      cwd: process.cwd(),
      port: await reserveEphemeralPort(),
      https: false,
      signal: new AbortController().signal,
      upstream: { hostname: "127.0.0.1", port: upstreamAddress.port },
      middlewares: [middleware],
    });
    cleanups.push(() => server.close());

    const publicUrl = new URL(server.origin);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(publicUrl.port), "127.0.0.1");
      let received = "";
      socket.setEncoding("utf8");
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        received += chunk;
      });
      socket.once("end", () => resolve(received));
      socket.once("connect", () => {
        socket.write(
          `GET /__hmr HTTP/1.1\r\nHost: ${publicUrl.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        );
      });
    });

    expect(response).toContain("101 Switching Protocols");
    expect(middleware).not.toHaveBeenCalled();
  });

  it("closes live WebSocket proxy connections during shutdown", async () => {
    let upstreamSocket: Duplex | undefined;
    const upstreamConnected = createDeferred<void>();
    const upstream = http.createServer();
    upstream.on("upgrade", (_request, socket) => {
      upstreamSocket = socket;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
      upstreamConnected.resolve();
    });
    await listen(upstream);
    cleanups.push(async () => {
      upstreamSocket?.destroy();
      await close(upstream);
    });
    const upstreamAddress = upstream.address() as AddressInfo;
    const server = await startClientMiddlewareServer({
      cwd: process.cwd(),
      port: await reserveEphemeralPort(),
      https: false,
      signal: new AbortController().signal,
      upstream: { hostname: "127.0.0.1", port: upstreamAddress.port },
      middlewares: [],
    });
    cleanups.push(() => server.close());

    const publicUrl = new URL(server.origin);
    const clientSocket = net.connect(Number(publicUrl.port), "127.0.0.1");
    cleanups.push(async () => {
      clientSocket.destroy();
    });
    const responseReceived = createDeferred<void>();
    clientSocket.setEncoding("utf8");
    clientSocket.on("data", (chunk) => {
      if (chunk.includes("101 Switching Protocols")) responseReceived.resolve();
    });
    clientSocket.once("connect", () => {
      clientSocket.write(
        `GET /__hmr HTTP/1.1\r\nHost: ${publicUrl.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });

    await Promise.all([upstreamConnected.promise, responseReceived.promise]);
    const clientClosed = waitForClose(clientSocket);

    await expect(server.close()).resolves.toBeUndefined();
    await clientClosed;
    expect(clientSocket.destroyed).toBe(true);
  });
});

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitForClose(socket: net.Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
