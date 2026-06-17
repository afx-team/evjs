declare module "react-server-dom-webpack/client" {
  export function createFromFetch(
    response: Promise<Response>,
    options?: {
      moduleBaseURL?: string;
    },
  ): unknown;

  export function createFromReadableStream(
    stream: ReadableStream<Uint8Array>,
    options?: {
      moduleBaseURL?: string;
    },
  ): unknown;
}

declare module "react-server-dom-webpack/server.node" {
  export function renderToReadableStream(
    model: unknown,
    webpackMap: unknown,
  ): Promise<ReadableStream<Uint8Array>>;
}
