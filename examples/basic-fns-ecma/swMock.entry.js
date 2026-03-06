/**
 * Service Worker adapter — runs server functions in the browser.
 *
 * Mirrors server.entry.mjs but for the Service Worker environment.
 * Intercepts /api/* requests (matching the default rpcEndpoint) and
 * handles them locally via Hono. Update the path prefix below if
 * using a custom rpcEndpoint.
 *
 * When running in Node.js (no native SW APIs), mock implementations
 * are provided so the entry can be tested outside a browser.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// ── Mock Service Worker APIs for Node.js testing ──

if (typeof self === "undefined") {
  const listeners = {};
  globalThis.self = /** @type {any} */ ({
    addEventListener(type, handler) {
      if (!listeners[type]) {
        listeners[type] = [];
      }
      listeners[type].push(handler);
    },
    __listeners: listeners,
  });
}

if (typeof FetchEvent === "undefined") {
  globalThis.FetchEvent = class FetchEvent extends Event {
    /** @type {Request} */
    request;
    /** @type {Promise<Response> | Response | undefined} */
    _response;

    /**
     * @param {string} type
     * @param {{ request: Request }} init
     */
    constructor(type, init) {
      super(type);
      this.request = init.request;
    }

    /** @param {Promise<Response> | Response} response */
    respondWith(response) {
      this._response = response;
    }
  };
}

// ── Actual SW entry logic ──

const require = createRequire(import.meta.url);

const manifest = JSON.parse(
  readFileSync(new URL("./server/manifest.json", import.meta.url), "utf-8"),
);
const bundle = require(`./server/${manifest.entry}`);
const app = bundle.createApp();

// SW fetch event
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(app.fetch(event.request));
  }
});

// ── Test helper: dispatch a mock FetchEvent and return the response ──

/**
 * Dispatch a mock fetch event through the SW handler.
 * @param {Request} request
 * @returns {Promise<Response | undefined>}
 */
export async function dispatchFetch(request) {
  const event = new FetchEvent("fetch", { request });
  const handlers = self.__listeners?.fetch || [];
  for (const handler of handlers) {
    handler(event);
  }
  return event._response ? await event._response : undefined;
}
