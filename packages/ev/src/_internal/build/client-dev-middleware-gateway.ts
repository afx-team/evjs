import fs from "node:fs";
import http, {
  type Server as HttpServer,
  type IncomingMessage,
  type RequestOptions,
  type ServerResponse,
} from "node:http";
import https, { type Server as HttpsServer } from "node:https";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { getLogger } from "@logtape/logtape";
import type { ClientDevMiddleware } from "../../plugin/index.js";

const logger = getLogger(["evjs", "client-dev-middleware-gateway"]);

export type ClientDevMiddlewareHttpsConfig =
  | boolean
  | { key: string; cert: string };

export interface ClientDevMiddlewareTlsCredentials {
  key: string | Buffer;
  cert: string | Buffer;
}

export type ClientDevMiddlewareCertificateFactory = () => Promise<
  ClientDevMiddlewareTlsCredentials | undefined
>;

export interface ClientDevMiddlewareGatewayHandle {
  readonly origin: string;
  /** Rejects on unexpected listener failure and stays pending after close. */
  readonly failure: Promise<never>;
  close(): Promise<void>;
}

export interface StartClientDevMiddlewareGatewayOptions {
  port: number;
  tls?: ClientDevMiddlewareTlsCredentials;
  signal: AbortSignal;
  middlewares: readonly ClientDevMiddleware[];
  upstream: {
    hostname: string;
    port: number;
  };
}

/** Reserve a best-effort loopback port for a bundler's private listener. */
export async function reserveClientDevMiddlewareUpstreamPort(): Promise<number> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error(
        "[evjs] Unable to reserve a client middleware upstream port.",
      );
    }
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Resolve the public gateway TLS credentials without coupling Core to a
 * bundler-specific certificate generator.
 */
export async function resolveClientDevMiddlewareTlsCredentials(
  cwd: string,
  config: ClientDevMiddlewareHttpsConfig,
  createSelfSignedCertificate?: ClientDevMiddlewareCertificateFactory,
): Promise<ClientDevMiddlewareTlsCredentials | undefined> {
  if (!config) return undefined;
  if (config !== true) {
    return {
      key: await readPemOrFile(cwd, config.key),
      cert: await readPemOrFile(cwd, config.cert),
    };
  }

  const credentials = await createSelfSignedCertificate?.();
  if (!credentials) {
    throw new Error(
      "[evjs] Unable to create the HTTPS certificate required by the client development middleware gateway.",
    );
  }
  return credentials;
}

/**
 * Start a public listener that runs plugin middleware and forwards everything
 * else to a private bundler listener. Upgrade requests bypass all middleware.
 */
export async function startClientDevMiddlewareGateway(
  options: StartClientDevMiddlewareGatewayOptions,
): Promise<ClientDevMiddlewareGatewayHandle> {
  let origin = "";
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const upgradedSockets = new Set<Duplex>();
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});

  const requestListener = (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    void runMiddlewareChain(
      options.middlewares,
      request,
      response,
      { origin, signal: options.signal },
      () => proxyHttpRequest(request, response, options.upstream),
    ).catch((error) => handleRequestError(response, error));
  };

  const server = createPublicServer(options.tls, requestListener);
  server.on("upgrade", (request, socket, head) => {
    trackUpgradeSocket(upgradedSockets, socket);
    trackUpgradeSocket(
      upgradedSockets,
      proxyUpgradeRequest(request, socket, head, options.upstream),
    );
  });
  server.on("error", (error) => {
    if (!closing) rejectFailure(error);
  });
  server.on("close", () => {
    if (!closing) {
      rejectFailure(
        new Error(
          "[evjs] Client development middleware gateway closed unexpectedly.",
        ),
      );
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, "0.0.0.0", resolve);
    });
  } catch (error) {
    closing = true;
    server.close();
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    closing = true;
    server.close();
    throw new Error(
      "[evjs] Client development middleware gateway has no TCP address.",
    );
  }
  origin = `${options.tls ? "https" : "http"}://localhost:${address.port}`;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      closing = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
        for (const socket of upgradedSockets) socket.destroy();
      });
    })();
    return closePromise;
  };

  return { origin, failure, close };
}

function createPublicServer(
  tls: ClientDevMiddlewareTlsCredentials | undefined,
  listener: (request: IncomingMessage, response: ServerResponse) => void,
): HttpServer | HttpsServer {
  return tls ? https.createServer(tls, listener) : http.createServer(listener);
}

async function readPemOrFile(
  cwd: string,
  value: string,
): Promise<string | Buffer> {
  const candidate = path.resolve(cwd, value);
  try {
    const stat = await fs.promises.stat(candidate);
    return stat.isFile() ? fs.promises.readFile(candidate) : value;
  } catch {
    return value;
  }
}

async function runMiddlewareChain(
  middlewares: readonly ClientDevMiddleware[],
  request: IncomingMessage,
  response: ServerResponse,
  context: Parameters<ClientDevMiddleware>[3],
  fallback: () => Promise<void>,
): Promise<void> {
  const dispatch = async (
    index: number,
    incomingError?: unknown,
  ): Promise<void> => {
    if (incomingError !== undefined) throw incomingError;
    const middleware = middlewares[index];
    if (!middleware) return fallback();

    let nextPromise: Promise<void> | undefined;
    const next = (error?: unknown): Promise<void> => {
      if (nextPromise) {
        return Promise.reject(
          new Error(
            "[evjs] client development middleware called next() more than once.",
          ),
        );
      }
      nextPromise = dispatch(index + 1, error);
      return nextPromise;
    };
    await middleware(request, response, next, context);
    if (nextPromise) await nextPromise;
  };
  await dispatch(0);
}

function proxyHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstream: StartClientDevMiddlewareGatewayOptions["upstream"],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const requestOptions: RequestOptions = {
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    };
    const proxyRequest = http.request(requestOptions, (proxyResponse) => {
      response.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.statusMessage,
        proxyResponse.headers,
      );
      proxyResponse.pipe(response);
      proxyResponse.once("end", resolve);
      proxyResponse.once("error", reject);
    });
    proxyRequest.once("error", reject);
    request.once("aborted", () => proxyRequest.destroy());
    request.pipe(proxyRequest);
  });
}

function proxyUpgradeRequest(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstream: StartClientDevMiddlewareGatewayOptions["upstream"],
): net.Socket {
  const proxySocket = net.connect(upstream.port, upstream.hostname);
  const fail = (error: unknown) => {
    logger.error`Failed to proxy bundler WebSocket upgrade: ${error}`;
    socket.destroy();
    proxySocket.destroy();
  };
  proxySocket.once("error", fail);
  socket.once("error", () => proxySocket.destroy());
  socket.once("close", () => proxySocket.destroy());
  proxySocket.once("close", () => socket.destroy());
  proxySocket.once("connect", () => {
    const headerLines: string[] = [
      `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}`,
    ];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      headerLines.push(
        `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1] ?? ""}`,
      );
    }
    proxySocket.write(`${headerLines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket).pipe(proxySocket);
  });
  return proxySocket;
}

function trackUpgradeSocket(sockets: Set<Duplex>, socket: Duplex): void {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
}

function handleRequestError(response: ServerResponse, error: unknown): void {
  logger.error`Client development middleware failed: ${error}`;
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  response.statusCode = 500;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(
    `[evjs] Client development middleware failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}
