/** Decode one URL segment without making malformed input fatal. */
export function safeDecodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Whether one URL decode turns a complete segment into `.` or `..`. */
export function isDotRouteSegment(segment: string): boolean {
  const decoded = safeDecodeRouteSegment(segment);
  return decoded === "." || decoded === "..";
}

/**
 * Create a stable key for a static route segment.
 *
 * Decoding happens before re-encoding so raw and encoded aliases share one
 * identity. Re-encoding preserves segment boundaries, including encoded `/`.
 */
export function canonicalizeStaticRouteSegment(segment: string): string {
  return safeDecodeRouteSegment(segment)
    .replaceAll("%", "%25")
    .replaceAll("/", "%2F");
}

export function staticRouteSegmentsEqual(left: string, right: string): boolean {
  return (
    canonicalizeStaticRouteSegment(left) ===
    canonicalizeStaticRouteSegment(right)
  );
}

/** Compile every one-decode-equivalent representation of a static segment. */
export function staticRouteSegmentToRegExpSource(segment: string): string {
  const decoded = safeDecodeRouteSegment(segment);
  const alternatives = [
    escapeRegExp(segment),
    createFlexibleDecodedSegmentRegExp(decoded),
  ];
  if (!decoded.includes("/") && safeDecodeRouteSegment(decoded) === decoded) {
    alternatives.push(escapeRegExp(decoded));
  }

  const unique = alternatives.filter(
    (value, index, values) => values.indexOf(value) === index,
  );
  return unique.length === 1 ? (unique[0] ?? "") : `(?:${unique.join("|")})`;
}

function createFlexibleDecodedSegmentRegExp(decoded: string): string {
  return [...decoded]
    .map((character) => {
      const encoded = utf8PercentRegExp(character);
      if (!canAppearRawInPathSegment(character)) return encoded;
      return `(?:${escapeRegExp(character)}|${encoded})`;
    })
    .join("");
}

function canAppearRawInPathSegment(character: string): boolean {
  return !/[/?#%\\\s]/.test(character);
}

function utf8PercentRegExp(character: string): string {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return escapeRegExp(character);
  }
  return encodeUtf8CodePoint(codePoint)
    .map((byte) => {
      const octet = byte.toString(16).toUpperCase().padStart(2, "0");
      return `%${[...octet]
        .map((digit) =>
          /[A-F]/.test(digit) ? `[${digit}${digit.toLowerCase()}]` : digit,
        )
        .join("")}`;
    })
    .join("");
}

function encodeUtf8CodePoint(codePoint: number): number[] {
  if (codePoint <= 0x7f) return [codePoint];
  if (codePoint <= 0x7ff) {
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  }
  if (codePoint <= 0xffff) {
    return [
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }
  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
