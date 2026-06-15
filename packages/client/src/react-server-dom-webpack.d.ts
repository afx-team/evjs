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
