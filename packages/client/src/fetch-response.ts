import {
  APPLICATION_JSON_CONTENT_TYPE,
  formatContentTypeHeaderValue,
  isApplicationJsonContentType,
} from "@evjs/shared";
import { isRecord } from "./validation.js";

export interface FetchResponseObject {
  ok: boolean;
  status?: unknown;
  statusText?: unknown;
  headers?: unknown;
  text?: unknown;
  json?: unknown;
}

export function assertFetchResponseObject(
  response: unknown,
  prefix: string,
): asserts response is FetchResponseObject {
  if (!isRecord(response)) {
    throw new Error(`${prefix}: fetch returned an invalid Response object.`);
  }
  if (typeof response.ok !== "boolean") {
    throw new Error(`${prefix}: fetch response.ok must be a boolean.`);
  }
}

export function assertFetchErrorResponseStatus(
  response: FetchResponseObject,
  prefix: string,
): asserts response is FetchResponseObject & {
  status: number;
  statusText: string;
} {
  if (typeof response.status !== "number") {
    throw new Error(
      `${prefix}: fetch response.status must be a number when ok is false.`,
    );
  }
  if (typeof response.statusText !== "string") {
    throw new Error(
      `${prefix}: fetch response.statusText must be a string when ok is false.`,
    );
  }
}

export function assertFetchResponseJson(
  response: FetchResponseObject,
  prefix: string,
): asserts response is FetchResponseObject & {
  json: () => Promise<unknown>;
} {
  if (typeof response.json !== "function") {
    throw new Error(`${prefix}: fetch response.json must be a function.`);
  }
}

export function assertFetchResponseJsonContentType(
  response: FetchResponseObject,
  prefix: string,
): void {
  const contentType = getFetchResponseContentType(response);
  if (isApplicationJsonContentType(contentType)) return;

  throw new Error(
    `${prefix}: fetch response Content-Type must be "${APPLICATION_JSON_CONTENT_TYPE}"; received ${formatContentTypeHeaderValue(
      contentType,
    )}.`,
  );
}

export async function readFetchErrorResponseBody(
  response: FetchResponseObject,
): Promise<string> {
  if (typeof response.text !== "function") return "";

  try {
    const body = (await response.text.call(response)) as unknown;
    return typeof body === "string" ? body.trim() : "";
  } catch {
    return "";
  }
}

export function formatFetchErrorResponseDetail(
  response: FetchResponseObject & {
    status: number;
    statusText: string;
  },
  responseBody: string,
): string {
  const statusText = response.statusText.trim();
  const statusLine = statusText
    ? `${response.status} ${statusText}`
    : `${response.status}`;

  if (!responseBody || responseBody === statusText) return statusLine;
  return `${statusLine}: ${responseBody}`;
}

export function getFetchResponseContentType(
  response: FetchResponseObject,
): string | null {
  const headers = response.headers;
  if (!isRecord(headers) || typeof headers.get !== "function") return null;
  const value = headers.get("Content-Type");
  return typeof value === "string" ? value : null;
}
