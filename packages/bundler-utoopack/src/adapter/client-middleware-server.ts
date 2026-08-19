import fs from "node:fs";
import http, {
  type Server as HttpServer,
  type IncomingMessage,
  type RequestOptions,
  type ServerResponse,
} from "node:http";
import https, { type Server as HttpsServer } from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { ClientDevMiddleware } from "@evjs/ev/plugin";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["evjs", "bundler-utoopack", "client-middleware"]);
const require = createRequire(import.meta.url);

type DevHttps = boolean | { key: string; cert: string };

export interface ClientMiddlewareServerHandle {
  readonly origin: string;
  /** Rejects on unexpected listener failure and stays pending after close. */
  readonly failure: Promise<never>;
  close(): Promise<void>;
}

interface StartClientMiddlewareServerOptions {
  cwd: string;
  port: number;
  https: DevHttps;
  signal: AbortSignal;
  middlewares: readonly ClientDevMiddleware[];
  upstream: {
    hostname: string;
    port: number;
  };
}

/** Reserve a best-effort internal port before Utoopack starts listening. */
export async function reserveEphemeralPort(): Promise<number> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("[evjs] Unable to reserve an internal Utoopack port.");
    }
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Start a public listener that runs plugin middleware and forwards everything
 * else to Utoopack. Upgrade requests intentionally bypass all middleware.
 */
export async function startClientMiddlewareServer(
  options: StartClientMiddlewareServerOptions,
): Promise<ClientMiddlewareServerHandle> {
  let origin = "";
  let closing = false;
  let closePromise: Promise<void> | undefined;
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

  const server = await createPublicServer(options, requestListener);
  server.on("upgrade", (request, socket, head) => {
    proxyUpgradeRequest(request, socket, head, options.upstream);
  });
  server.on("error", (error) => {
    if (!closing) rejectFailure(error);
  });
  server.on("close", () => {
    if (!closing) {
      rejectFailure(
        new Error(
          "[evjs] Utoopack client middleware listener closed unexpectedly.",
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
      "[evjs] Utoopack client middleware listener has no TCP address.",
    );
  }
  origin = `${options.https ? "https" : "http"}://localhost:${address.port}`;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      closing = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      });
    })();
    return closePromise;
  };

  return { origin, failure, close };
}

async function createPublicServer(
  options: StartClientMiddlewareServerOptions,
  listener: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<HttpServer | HttpsServer> {
  if (!options.https) return http.createServer(listener);
  const credentials = await resolveTlsCredentials(options.cwd, options.https);
  return https.createServer(credentials, listener);
}

async function resolveTlsCredentials(
  cwd: string,
  config: Exclude<DevHttps, false>,
): Promise<{ key: string | Buffer; cert: string | Buffer }> {
  if (config !== true) {
    return {
      key: await readPemOrFile(cwd, config.key),
      cert: await readPemOrFile(cwd, config.cert),
    };
  }

  const { createSelfSignedCertificate } =
    require("@utoo/pack/cjs/utils/mkcert.js") as {
      createSelfSignedCertificate(
        host?: string,
      ): Promise<{ key: string; cert: string } | undefined>;
    };
  const certificate = await createSelfSignedCertificate("localhost");
  if (!certificate) {
    throw new Error(
      "[evjs] Unable to create the HTTPS certificate required by the Utoopack client middleware listener.",
    );
  }
  return {
    key: await fs.promises.readFile(certificate.key),
    cert: await fs.promises.readFile(certificate.cert),
  };
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
  upstream: StartClientMiddlewareServerOptions["upstream"],
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
  upstream: StartClientMiddlewareServerOptions["upstream"],
): void {
  const proxySocket = net.connect(upstream.port, upstream.hostname);
  const fail = (error: unknown) => {
    logger.error`Failed to proxy Utoopack WebSocket upgrade: ${error}`;
    socket.destroy();
    proxySocket.destroy();
  };
  proxySocket.once("error", fail);
  socket.once("error", () => proxySocket.destroy());
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
