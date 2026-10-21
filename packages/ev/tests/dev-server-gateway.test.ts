import { once } from "node:events";
import https from "node:https";
import { serve } from "@evjs/server/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDevServerGateway } from "../src/_internal/build/dev/server-gateway.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(
  fetch: Parameters<typeof serve>[0]["fetch"],
  options: Partial<Parameters<typeof startDevServerGateway>[0]> = {},
) {
  const abort = new AbortController();
  const gateway = await startDevServerGateway({
    cwd: process.cwd(),
    port: 0,
    https: false,
    signal: abort.signal,
    ...options,
  });
  const child = serve(
    { fetch },
    {
      host: "127.0.0.1",
      port: gateway.upstreamPort,
      https: options.https || undefined,
    },
  );
  if (!child.listening) await once(child, "listening");
  cleanups.push(async () => {
    abort.abort();
    await gateway.close();
    if ("closeAllConnections" in child) child.closeAllConnections();
    await new Promise<void>((resolve) => child.close(() => resolve()));
  });
  return { gateway, abort };
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("development API server gateway", () => {
  it("drains a response that completes during the grace period", async () => {
    let release: (() => void) | undefined;
    const { gateway } = await setup(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Response("finished"));
        }),
    );
    gateway.resume();
    const request = fetch(gateway.origin).then((response) => response.text());
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const drain = gateway.suspend();
    release?.();
    await expect(request).resolves.toBe("finished");
    await expect(drain).resolves.toBeUndefined();
  });

  it("ends long responses after the grace period without replaying POSTs or releasing queued requests", async () => {
    let release: (() => void) | undefined;
    const writes: string[] = [];
    const { gateway } = await setup(
      async (request) => {
        if (new URL(request.url).pathname === "/events") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: old\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        const body = await request.text();
        writes.push(body);
        if (body === "old") {
          return new Promise((resolve) => {
            release = () => resolve(new Response("committed"));
          });
        }
        return new Response("new");
      },
      { drainTimeoutMs: 120 },
    );
    gateway.resume();
    const oldWrite = fetch(gateway.origin, {
      method: "POST",
      body: "old",
    }).then((response) => response.text());
    void oldWrite.catch(() => {});
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const events = await fetch(`${gateway.origin}/events`);
    const reader = events.body?.getReader();
    expect((await reader?.read())?.value).toBeDefined();
    const nextEvent = reader?.read();
    void nextEvent?.catch(() => {});
    const drain = gateway.suspend();
    const queuedWrite = fetch(gateway.origin, {
      method: "POST",
      body: "queued",
    }).then((response) => response.text());
    void queuedWrite.catch(() => {});
    try {
      await delay();
      expect(writes).toEqual(["old"]);
      await expect(drain).resolves.toBeUndefined();
      await expect(oldWrite).rejects.toBeInstanceOf(Error);
      await expect(nextEvent).rejects.toBeInstanceOf(Error);
      expect(writes).toEqual(["old"]);
      gateway.resume();
      await expect(queuedWrite).resolves.toBe("new");
      expect(writes).toEqual(["old", "queued"]);
    } finally {
      release?.();
    }
  });

  it("fails waiting requests with diagnostics and recovers without replaying them", async () => {
    const handled = vi.fn(
      async (request: Request) => new Response(await request.text()),
    );
    const { gateway } = await setup(handled);
    const waiting = fetch(gateway.origin, {
      method: "POST",
      body: "failed write",
    });
    await delay();
    expect(handled).not.toHaveBeenCalled();
    gateway.fail(new Error("bootstrap failed"));
    const failed = await waiting;
    expect(failed.status).toBe(503);
    await expect(failed.text()).resolves.toContain("bootstrap failed");
    expect((await fetch(gateway.origin)).status).toBe(503);
    gateway.resume();
    const recovered = await fetch(gateway.origin, {
      method: "POST",
      body: "recovered",
    });
    expect(recovered.status).toBe(200);
    await expect(recovered.text()).resolves.toBe("recovered");
    expect(handled).toHaveBeenCalledOnce();
  });

  it.each([
    "cancel",
    "close",
    "abort",
  ])("%s releases waiting and active requests", async (action) => {
    const started = vi.fn(() => new Promise<Response>(() => {}));
    const { gateway, abort } = await setup(started);
    const cancellation = new AbortController();
    const cancelled = fetch(gateway.origin, { signal: cancellation.signal });
    void cancelled.catch(() => {});
    await delay();
    cancellation.abort();
    await expect(cancelled).rejects.toBeInstanceOf(Error);
    await delay();
    gateway.resume();
    const client = new AbortController();
    const active = fetch(gateway.origin, { signal: client.signal });
    void active.catch(() => {});
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    const drain = gateway.suspend();
    void drain.catch(() => {});
    const waitingClient = new AbortController();
    const queued = fetch(gateway.origin, { signal: waitingClient.signal });
    void queued.catch(() => {});
    await delay();
    if (action === "cancel") {
      client.abort();
      waitingClient.abort();
    } else if (action === "abort") abort.abort();
    else await gateway.close();
    await Promise.all([
      expect(active).rejects.toBeInstanceOf(Error),
      expect(queued).rejects.toBeInstanceOf(Error),
      action === "cancel"
        ? expect(drain).resolves.toBeUndefined()
        : expect(drain).rejects.toThrow("closed while draining"),
    ]);
    await gateway.close();
    expect(started).toHaveBeenCalledOnce();
    await setup(() => new Response(), { port: +new URL(gateway.origin).port });
  });

  it("preserves HTTPS scheme and public Host in the actual Node fetch runtime", async () => {
    const { gateway } = await setup((request) => new Response(request.url), {
      https: TEST_TLS,
    });
    gateway.resume();
    const result = await new Promise<string>((resolve, reject) => {
      const request = https.get(
        `${gateway.origin}/path?query=1`,
        {
          headers: { host: "mobile.example:8443" },
          rejectUnauthorized: false,
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.once("end", () => resolve(body));
          response.once("error", reject);
        },
      );
      request.once("error", reject);
    });
    expect(result).toBe("https://mobile.example:8443/path?query=1");
  });
});

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
