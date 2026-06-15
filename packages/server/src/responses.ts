import { TEXT_PLAIN_UTF8_CONTENT_TYPE } from "@evjs/shared";

export function textResponse(
  body: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", TEXT_PLAIN_UTF8_CONTENT_TYPE);
  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}
