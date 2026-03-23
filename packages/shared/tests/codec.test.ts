import { describe, expect, it } from "vitest";
import { type Codec, jsonCodec } from "../src/codec.js";

describe("jsonCodec", () => {
  it("serializes a plain object to JSON string", () => {
    const data = { fnId: "abc", args: [1, "hello"] };
    const serialized = jsonCodec.serialize(data);
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized as string)).toEqual(data);
  });

  it("deserializes a JSON string to an object", () => {
    const json = '{"result":"ok"}';
    const deserialized = jsonCodec.deserialize(json);
    expect(deserialized).toEqual({ result: "ok" });
  });

  it("round-trips complex data", () => {
    const data = {
      users: [
        { id: 1, name: "Alice", tags: ["admin", "user"] },
        { id: 2, name: "Bob", tags: [] },
      ],
      total: 2,
      nested: { a: { b: { c: true } } },
    };
    const result = jsonCodec.deserialize(jsonCodec.serialize(data));
    expect(result).toEqual(data);
  });

  it("handles null and primitive values", () => {
    expect(jsonCodec.deserialize(jsonCodec.serialize(null))).toBeNull();
    expect(jsonCodec.deserialize(jsonCodec.serialize(42))).toBe(42);
    expect(jsonCodec.deserialize(jsonCodec.serialize("hello"))).toBe("hello");
    expect(jsonCodec.deserialize(jsonCodec.serialize(true))).toBe(true);
  });

  it("has application/json content type", () => {
    expect(jsonCodec.contentType).toBe("application/json");
  });
});

describe("custom Codec", () => {
  it("accepts a custom codec implementation", () => {
    const uppercaseCodec: Codec = {
      contentType: "text/plain",
      serialize: (data) => JSON.stringify(data).toUpperCase(),
      deserialize: (raw) => JSON.parse((raw as string).toLowerCase()),
    };

    const data = { name: "alice" };
    const serialized = uppercaseCodec.serialize(data);
    expect(serialized).toBe('{"NAME":"ALICE"}');

    const deserialized = uppercaseCodec.deserialize(serialized);
    expect(deserialized).toEqual(data);
  });
});
