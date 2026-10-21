import fs from "node:fs/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { serve } from "@evjs/server/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveClientDevMiddlewareUpstreamPort } from "../src/_internal/build/dev/client-middleware-server.js";
import {
  type DevServerGateway,
  startDevServerGateway,
} from "../src/_internal/build/dev/server-gateway.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startGateway(
  overrides: Partial<Parameters<typeof startDevServerGateway>[0]> = {},
) {
  const gateway = await startDevServerGateway({
    cwd: process.cwd(),
    port: 0,
    https: false,
    signal: new AbortController().signal,
    ...overrides,
  });
  cleanups.push(() => gateway.close());
  return gateway;
}

async function startChild(
  gateway: DevServerGateway,
  listener: http.RequestListener,
) {
  const server = http.createServer(listener);
  await listen(server, gateway.upstreamPort);
  cleanups.push(() => close(server));
  return server;
}

describe("development API server gateway", () => {
  it("holds initial requests until the child is ready", async () => {
    const gateway = await startGateway();
    const pending = send(gateway.origin, "/initial");
    let completed = false;
    void pending.response.then(() => {
      completed = true;
    });
    await delay(30);
    expect(completed).toBe(false);

    await startChild(gateway, (_request, response) => response.end("ready"));
    gateway.resume();
    await expect(pending.response).resolves.toMatchObject({
      status: 200,
      body: "ready",
    });
  });

  it("queues GET, HEAD and a streamed POST across child replacement without replay", async () => {
    const gateway = await startGateway();
    const oldChild = await startChild(gateway, (_request, response) => {
      response.end("old");
    });
    gateway.resume();
    await gateway.suspend();
    await close(oldChild);

    const get = send(gateway.origin, "/read?query=1");
    const head = send(gateway.origin, "/head", { method: "HEAD" });
    const post = send(gateway.origin, "/write", {
      method: "POST",
      body: ["first-", "second"],
      headers: { "x-request-value": "preserved" },
    });
    const requests: Array<{ method: string; path: string; body: string }> = [];
    await startChild(gateway, async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({
        method: request.method ?? "GET",
        path: request.url ?? "",
        body,
      });
      if (request.method === "POST") {
        expect(request.headers["x-request-value"]).toBe("preserved");
      }
      response.writeHead(202, "Child Ready", {
        "x-child": "new",
        "set-cookie": ["one=1", "two=2"],
      });
      response.end(`new:${body}`);
    });
    await delay(30);
    expect(requests).toEqual([]);

    gateway.resume();
    gateway.resume();
    const [getResult, headResult, postResult] = await Promise.all([
      get.response,
      head.response,
      post.response,
    ]);
    expect(getResult).toMatchObject({
      status: 202,
      statusMessage: "Child Ready",
      body: "new:",
    });
    expect(headResult).toMatchObject({ status: 202, body: "" });
    expect(postResult).toMatchObject({ status: 202, body: "new:first-second" });
    expect(postResult.headers["x-child"]).toBe("new");
    expect(postResult.headers["set-cookie"]).toEqual(["one=1", "two=2"]);
    expect(requests).toHaveLength(3);
    expect(requests.filter((request) => request.method === "POST")).toEqual([
      { method: "POST", path: "/write", body: "first-second" },
    ]);
    expect(requests.find((request) => request.method === "GET")?.path).toBe(
      "/read?query=1",
    );
  });

  it("drains the old response before allowing its child to be stopped", async () => {
    const gateway = await startGateway();
    const admitted = deferred<http.ServerResponse>();
    const child = await startChild(gateway, (_request, response) => {
      response.write("old-");
      admitted.resolve(response);
    });
    gateway.resume();
    const oldRequest = send(gateway.origin, "/slow");
    const oldResponse = await admitted.promise;
    let drained = false;
    const drain = gateway.suspend().then(() => {
      drained = true;
    });
    const next = send(gateway.origin, "/next");
    await delay(30);
    expect(drained).toBe(false);
    oldResponse.end("complete");
    await drain;
    await expect(oldRequest.response).resolves.toMatchObject({
      body: "old-complete",
    });
    await close(child);

    await startChild(gateway, (_request, response) =>
      response.end("replacement"),
    );
    gateway.resume();
    await expect(next.response).resolves.toMatchObject({ body: "replacement" });
  });

  it("drains cancelled clients and drops cancelled queued requests", async () => {
    const gateway = await startGateway();
    const admitted = deferred<void>();
    const disconnected = deferred<void>();
    const paths: string[] = [];
    await startChild(gateway, (request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/cancel-active") {
        response.once("close", () => disconnected.resolve());
        admitted.resolve();
      } else response.end("ready");
    });
    gateway.resume();
    const active = send(gateway.origin, "/cancel-active");
    await admitted.promise;
    const drain = gateway.suspend();
    const queued = send(gateway.origin, "/cancel-queued");
    await delay(30);
    queued.request.destroy(new Error("cancel queued"));
    active.request.destroy(new Error("cancel active"));
    await Promise.all([
      expect(queued.response).rejects.toThrow("cancel queued"),
      expect(active.response).rejects.toThrow("cancel active"),
      drain,
      disconnected.promise,
    ]);
    gateway.resume();
    await expect(
      send(gateway.origin, "/check").response,
    ).resolves.toMatchObject({ body: "ready" });
    expect(paths).toEqual(["/cancel-active", "/check"]);
  });

  it("rejects a bounded drain without terminating or replaying an admitted write", async () => {
    const gateway = await startGateway({ drainTimeoutMs: 30 });
    const admitted = deferred<http.ServerResponse>();
    let writes = 0;
    await startChild(gateway, async (request, response) => {
      for await (const _chunk of request) {
        /* Consume the admitted write. */
      }
      writes += 1;
      admitted.resolve(response);
    });
    gateway.resume();
    const write = send(gateway.origin, "/write", {
      method: "POST",
      body: ["payload"],
    });
    const response = await admitted.promise;
    await expect(gateway.suspend()).rejects.toThrow(
      "could not drain 1 active request",
    );
    expect(response.destroyed).toBe(false);
    gateway.resume();
    response.end("committed");
    await expect(write.response).resolves.toMatchObject({ body: "committed" });
    expect(writes).toBe(1);
  });

  it("returns diagnostic 503s after failure and recovers on resume", async () => {
    const gateway = await startGateway();
    const waiting = send(gateway.origin, "/failed-write", {
      method: "POST",
      body: ["once"],
    });
    await delay(30);
    gateway.fail(new Error("child bootstrap failed"));
    await expect(waiting.response).resolves.toMatchObject({
      status: 503,
      body: expect.stringContaining("child bootstrap failed"),
    });
    await expect(
      send(gateway.origin, "/failed-read").response,
    ).resolves.toMatchObject({ status: 503 });

    const paths: string[] = [];
    await startChild(gateway, (request, response) => {
      paths.push(request.url ?? "");
      response.end("recovered");
    });
    gateway.resume();
    await expect(
      send(gateway.origin, "/recovered").response,
    ).resolves.toMatchObject({ status: 200, body: "recovered" });
    expect(paths).toEqual(["/recovered"]);
  });

  it("closes queued and in-flight requests without hanging", async () => {
    const gateway = await startGateway();
    const admitted = deferred<void>();
    await startChild(gateway, (_request, response) => {
      response.write("stream");
      admitted.resolve();
    });
    gateway.resume();
    const active = send(gateway.origin, "/stream");
    await admitted.promise;
    const drain = gateway.suspend();
    void drain.catch(() => {});
    const queued = send(gateway.origin, "/queued");
    await delay(30);
    await Promise.all([gateway.close(), gateway.close()]);
    await expect(active.response).rejects.toBeInstanceOf(Error);
    await expect(queued.response).rejects.toBeInstanceOf(Error);
    await expect(drain).rejects.toThrow("closed while draining");
    const replacement = http.createServer();
    await listen(replacement, Number(new URL(gateway.origin).port));
    cleanups.push(() => close(replacement));
  });

  it("rejects an already-aborted start and closes after abort", async () => {
    const aborted = new AbortController();
    aborted.abort(new Error("already cancelled"));
    await expect(startGateway({ signal: aborted.signal })).rejects.toThrow(
      "already cancelled",
    );
    const controller = new AbortController();
    const gateway = await startGateway({ signal: controller.signal });
    controller.abort();
    await gateway.close();
    const replacement = http.createServer();
    await listen(replacement, Number(new URL(gateway.origin).port));
    cleanups.push(() => close(replacement));
  });

  it("releases the public listener when aborted while listen is starting", async () => {
    const controller = new AbortController();
    const port = await reserveClientDevMiddlewareUpstreamPort();
    const originalListen = http.Server.prototype.listen;
    const spy = vi
      .spyOn(http.Server.prototype, "listen")
      .mockImplementation(function (
        this: http.Server,
        ...args: Parameters<http.Server["listen"]>
      ) {
        const server = originalListen.apply(this, args);
        controller.abort(new Error("cancelled during listen"));
        return server;
      });
    try {
      await expect(
        startGateway({ port, signal: controller.signal }),
      ).rejects.toThrow("cancelled during listen");
    } finally {
      spy.mockRestore();
    }
    const replacement = http.createServer();
    await listen(replacement, port);
    cleanups.push(() => close(replacement));
  });

  it("terminates unsupported upgrade requests", async () => {
    const gateway = await startGateway();
    const url = new URL(gateway.origin);
    const result = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(url.port), "127.0.0.1");
      let body = "";
      socket.setEncoding("utf8");
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        body += chunk;
      });
      socket.once("end", () => resolve(body));
      socket.once("connect", () => {
        socket.write(
          `GET /socket HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        );
      });
    });
    expect(result).toContain("501 Not Implemented");
  });

  it("preserves HTTPS scheme and the public Host in the actual Node fetch runtime", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-gateway-tls-"));
    cleanups.push(() => fs.rm(cwd, { recursive: true, force: true }));
    await Promise.all([
      fs.writeFile(path.join(cwd, "key.pem"), TEST_TLS.key),
      fs.writeFile(path.join(cwd, "cert.pem"), TEST_TLS.cert),
    ]);
    const gateway = await startGateway({
      cwd,
      https: { key: "key.pem", cert: "cert.pem" },
    });
    const child = serve(
      { fetch: (request) => new Response(request.url, { status: 201 }) },
      { host: "127.0.0.1", port: gateway.upstreamPort, https: TEST_TLS },
    );
    cleanups.push(() => close(child));
    if (!child.listening)
      await new Promise<void>((resolve) => child.once("listening", resolve));
    gateway.resume();
    const result = await send(gateway.origin, "/path?query=1", {
      headers: { host: "mobile.example:8443" },
    }).response;
    expect(result).toMatchObject({
      status: 201,
      body: "https://mobile.example:8443/path?query=1",
    });
  });
});

function listen(server: http.Server | https.Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?: () => void;
}) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
      )
        reject(error);
      else resolve();
    });
    server.closeAllConnections?.();
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function send(
  origin: string,
  requestPath: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string[];
  } = {},
) {
  let request!: http.ClientRequest;
  const response = new Promise<{
    status: number;
    statusMessage: string;
    headers: IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const connect = origin.startsWith("https:") ? https.request : http.request;
    request = connect(
      new URL(requestPath, origin),
      {
        method: options.method,
        headers: options.headers,
        agent: false,
        rejectUnauthorized: false,
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => {
          body += chunk;
        });
        incoming.once("error", reject);
        incoming.once("aborted", () => reject(new Error("Response aborted")));
        incoming.once("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            statusMessage: incoming.statusMessage ?? "",
            headers: incoming.headers,
            body,
          }),
        );
      },
    );
    request.once("error", reject);
    for (const chunk of options.body ?? []) request.write(chunk);
    request.end();
  });
  void response.catch(() => {});
  return { request, response };
}

// Test-only localhost certificate and key.
const TEST_TLS = {
  key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgUBDiaxMnQZcq5zej
YkPCp/ZRod6RSR8BeseOrgrWOyyhRANCAATr3f4zywUUFoH76gFL6fmi5Jnfa3Z+
H/2g0WX/9Tb/JBpxSKAn8s+6Q6x98uEKpPYeh8A8qw50uhKG1f7DJV+v
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIBfDCCASOgAwIBAgIUYaKm+FWGMGs6A0+wi5SQRIaPETgwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAyMTA4NDYyMloXDTM2MTAxODA4
NDYyMlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAE693+M8sFFBaB++oBS+n5ouSZ32t2fh/9oNFl//U2/yQacUigJ/LPukOs
ffLhCqT2HofAPKsOdLoShtX+wyVfr6NTMFEwHQYDVR0OBBYEFNn5ELEaDB/Ga5TF
gSLxKn4+18CiMB8GA1UdIwQYMBaAFNn5ELEaDB/Ga5TFgSLxKn4+18CiMA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgbR9wpN6sHtlJfZKLMfY3/KTR
Q54SyXGzB7x8JcNvLCkCIFpDbdpA41LMIFdmHd6rvOJo4Guoif4w7Wd0nyvtxQYj
-----END CERTIFICATE-----`,
};
