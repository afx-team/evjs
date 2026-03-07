/**
 * Pluggable codec interface for serialization/deserialization.
 *
 * By default the framework uses JSON. Implement this interface to use
 * a custom codec (e.g. protobuf, msgpack, superjson, devalue).
 *
 * @example
 * ```ts
 * import superjson from "superjson";
 *
 * const superJsonCodec: Codec = {
 *   contentType: "application/json",
 *   serialize: (data) => superjson.stringify(data),
 *   deserialize: (raw) => superjson.parse(raw as string),
 * };
 * ```
 */
export interface Codec {
  /**
   * Content-Type header value for the serialized format.
   * Defaults to `"application/json"` when not specified.
   */
  contentType?: string;

  /** Serialize a JS value for transmission. */
  serialize(data: unknown): string | ArrayBuffer;

  /** Deserialize a raw payload back to a JS value. */
  deserialize(raw: string | ArrayBuffer): unknown;
}

/** Built-in JSON codec (the default). */
export const jsonCodec: Codec = {
  contentType: "application/json",
  serialize: (data) => JSON.stringify(data),
  deserialize: (raw) => JSON.parse(raw as string),
};
