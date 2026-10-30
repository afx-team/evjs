import http, {
  type ClientRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import {
  reserveClientDevMiddlewareUpstreamPort,
  resolveClientDevMiddlewareTlsCredentials,
} from "./client-middleware-server.js";

export interface DevServerGateway {
  readonly origin: string;
  readonly upstreamPort: number;
  /** Rejects only for an unexpected public listener failure. */
  readonly failure: Promise<never>;
  /** Block admission, drain responses, then end any left after the grace period. */
  suspend(): Promise<void>;
  resume(): void;
  /** Fail queued and future requests until a successful resume. */
  fail(error: unknown): void;
  close(): Promise<void>;
}

interface StartDevServerGatewayOptions {
  cwd: string;
  port: number;
  https: false | { key: string; cert: string };
  signal: AbortSignal;
  drainTimeoutMs?: number;
}

interface GatewayRequest {
  forward(): void;
  unavailable(error: unknown): void;
  cancel(): void;
}

const DRAIN_TIMEOUT_MS = 10_000;

/** Keep one API listener across child replacements, without replaying requests. */
export async function startDevServerGateway(
  options: StartDevServerGatewayOptions,
): Promise<DevServerGateway> {
  options.signal.throwIfAborted();
  const drainTimeoutMs = options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
  const tls = await resolveClientDevMiddlewareTlsCredentials(
    options.cwd,
    options.https,
  );
  options.signal.throwIfAborted();

  let state: "suspended" | "ready" | "failed" | "closed" = "suspended";
  let unavailableReason: unknown;
  let upstreamPort = 0;
  let closePromise: Promise<void> | undefined;
  const pending = new Set<GatewayRequest>();
  const active = new Set<GatewayRequest>();
  let drain:
    | {
        promise: Promise<void>;
        settle(error?: Error): void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  const sockets = new Set<Socket>();
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});

  const settleDrain = (error?: Error) => {
    if (!drain) return;
    clearTimeout(drain.timer);
    drain.settle(error);
    drain = undefined;
  };

  const listener = (request: IncomingMessage, response: ServerResponse) => {
    let settled = false;
    let proxyRequest: ClientRequest | undefined;
    let proxyResponse: IncomingMessage | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      pending.delete(exchange);
      active.delete(exchange);
      request.off("aborted", cancel);
      request.off("error", cancel);
      response.off("close", cancel);
      response.off("error", cancel);
      if (active.size === 0) settleDrain();
    };
    const destroyProxy = () => {
      proxyRequest?.destroy();
      proxyResponse?.destroy();
    };
    const cancel = () => {
      if (settled) return;
      request.unpipe(proxyRequest);
      destroyProxy();
      response.destroy();
      finish();
    };
    const unavailable = (error: unknown) => {
      if (settled) return;
      if (response.headersSent) {
        response.destroy();
      } else {
        response.writeHead(503, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          connection: "close",
        });
        response.end(
          `[evjs] Development API server unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      request.resume();
      finish();
      destroyProxy();
    };
    const exchange: GatewayRequest = {
      cancel,
      unavailable,
      forward() {
        if (settled) return;
        pending.delete(exchange);
        active.add(exchange);
        const send = tls ? https.request : http.request;
        proxyRequest = send(
          {
            hostname: "127.0.0.1",
            port: upstreamPort,
            method: request.method,
            path: request.url,
            headers: request.headers,
            agent: false,
            ...(tls ? { rejectUnauthorized: false } : {}),
          },
          (upstream) => {
            proxyResponse = upstream;
            if (settled) {
              upstream.destroy();
              return;
            }
            response.writeHead(
              upstream.statusCode ?? 502,
              upstream.statusMessage,
              upstream.rawHeaders,
            );
            upstream.once("end", finish);
            upstream.once("error", unavailable);
            upstream.once("aborted", () => {
              unavailable(new Error("The API response ended prematurely."));
            });
            upstream.pipe(response);
          },
        );
        proxyRequest.once("error", unavailable);
        // IncomingMessage stays paused while queued. Transfer its body once,
        // preserving backpressure; never retry a request accepted by the child.
        request.pipe(proxyRequest);
      },
    };
    request.once("aborted", cancel);
    request.once("error", cancel);
    response.once("close", cancel);
    response.once("error", cancel);
    if (state === "ready") exchange.forward();
    else if (state === "failed") unavailable(unavailableReason);
    else if (state === "closed") cancel();
    else pending.add(exchange);
  };

  const server = tls
    ? https.createServer(tls, listener)
    : http.createServer(listener);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (_request, socket) => {
    socket.end(
      "HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  const fail = (error: unknown) => {
    if (state === "closed") return;
    state = "failed";
    unavailableReason = error;
    for (const exchange of pending) exchange.unavailable(error);
  };
  const unexpected = (error: unknown) => {
    if (state === "closed") return;
    fail(error);
    rejectFailure(error);
  };
  server.on("error", unexpected);
  server.on("close", () => {
    unexpected(
      new Error("[evjs] Development API gateway closed unexpectedly."),
    );
  });

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    state = "closed";
    options.signal.removeEventListener("abort", onAbort);
    settleDrain(
      new Error("[evjs] Development API gateway closed while draining."),
    );
    for (const exchange of pending) exchange.cancel();
    for (const exchange of active) exchange.cancel();
    closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        )
          reject(error);
        else resolve();
      });
      for (const socket of sockets) socket.destroy();
    });
    return closePromise;
  };
  const onAbort = () => {
    void close().catch(rejectFailure);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
    options.signal.addEventListener("abort", onAbort, { once: true });
    options.signal.throwIfAborted();
    upstreamPort = await reserveClientDevMiddlewareUpstreamPort();
    options.signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("[evjs] Development API gateway has no TCP address.");
    }
    return {
      origin: `${tls ? "https" : "http"}://localhost:${address.port}`,
      upstreamPort,
      failure,
      fail,
      close,
      suspend() {
        if (state === "closed") {
          return Promise.reject(
            new Error("[evjs] Development API gateway is closed."),
          );
        }
        state = "suspended";
        if (active.size === 0) return Promise.resolve();
        if (!drain) {
          let settle!: (error?: Error) => void;
          const promise = new Promise<void>((resolve, reject) => {
            settle = (error) => (error ? reject(error) : resolve());
          });
          // SSE and other long responses must not prevent source updates.
          const timer = setTimeout(() => {
            for (const exchange of active) exchange.cancel();
          }, drainTimeoutMs).unref();
          drain = { promise, settle, timer };
        }
        return drain.promise;
      },
      resume() {
        if (state === "closed") return;
        state = "ready";
        unavailableReason = undefined;
        for (const exchange of pending) exchange.forward();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
