import { createHash } from "node:crypto";
import path from "node:path";

const ID_UNSAFE_CHARACTERS = /[^a-zA-Z0-9_-]+/g;

/** Derive the generated page/route id for a URL route path. */
export function deriveRouteIdFromPath(routePath: string): string {
  const id = routePath
    .replace(/^\/+|\/+$/g, "")
    .replace(/\$/g, "")
    .replace(ID_UNSAFE_CHARACTERS, "_");
  return id || "index";
}

/** Sanitize an existing page id for build artifact names. */
export function sanitizePageId(pageId: string): string {
  return pageId.replace(ID_UNSAFE_CHARACTERS, "_");
}

/** Parse a "module#export" reference string. */
export function parseModuleRef(ref: string): {
  module: string;
  exportName: string;
} {
  const idx = ref.indexOf("#");
  if (idx === -1) {
    throw new Error(
      `Invalid module reference "${ref}". Expected format: "module#exportName".`,
    );
  }
  return { module: ref.slice(0, idx), exportName: ref.slice(idx + 1) };
}

/** Hash a string to a 16-character hex digest (SHA-256, truncated). */
function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Derive a stable module ID from a file path relative to root. */
export function makeModuleId(
  rootContext: string,
  resourcePath: string,
): string {
  return hashString(path.relative(rootContext, resourcePath));
}

/**
 * Hash a server function using Utoopack's server-reference action ID algorithm.
 *
 * Keep this aligned with:
 * https://github.com/utooland/utoo/blob/cbb5e27ba92c593dc1d709ba74aa154227b03e57/crates/pack-core/src/server_reference/proxy.rs#L28-L36
 */
export function hashServerFunction(
  moduleId: string,
  exportName: string,
): string {
  return hashString(`${moduleId}#${exportName}`);
}

/** Derive a stable function ID from the file path and export name. */
export function makeFnId(
  rootContext: string,
  resourcePath: string,
  exportName: string,
): string {
  const moduleId = toPosixPath(path.relative(rootContext, resourcePath));
  return hashServerFunction(moduleId, exportName);
}

export function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/").replaceAll("\\", "/");
}

export function toProjectPath(cwd: string, absolute: string): string {
  return `./${toPosixPath(path.relative(cwd, absolute))}`;
}

export function isInsideCwd(cwd: string, candidate: string): boolean {
  const relative = path.relative(cwd, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export type FrameworkDirective = "use client" | "use server";

export const CONFLICTING_FRAMEWORK_DIRECTIVES_MESSAGE =
  '"use client" and "use server" directives cannot be used in the same module. Split client references and server functions into separate files.';

/** Check whether the source contains a framework directive in its directive prologue. */
export function detectFrameworkDirective(
  source: string,
  directive: FrameworkDirective,
): boolean {
  let index = 0;

  while (index < source.length) {
    const start = firstCodeTokenIndex(source, index);
    if (start === undefined) return false;

    const literal = readSimpleStringLiteral(source, start);
    if (!literal) return false;

    const statementEnd = directiveStatementEndIndex(source, literal.end);
    if (statementEnd === undefined) return false;
    if (literal.value === directive) return true;
    index = statementEnd;
  }

  return false;
}

/** Check whether the source contains the "use server" directive. */
export function detectUseServer(source: string): boolean {
  return detectFrameworkDirective(source, "use server");
}

export function detectConflictingFrameworkDirectives(source: string): boolean {
  return (
    detectFrameworkDirective(source, "use client") &&
    detectFrameworkDirective(source, "use server")
  );
}

function firstCodeTokenIndex(
  source: string,
  start = source.charCodeAt(0) === 0xfeff ? 1 : 0,
): number | undefined {
  let index = start;

  while (index < source.length) {
    const char = source[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const lineEnd = lineCommentEndIndex(source, index + 2);
      if (lineEnd === -1) return undefined;
      index = lineEnd + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd === -1) return undefined;
      index = commentEnd + 2;
      continue;
    }
    return index;
  }

  return undefined;
}

function readSimpleStringLiteral(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return undefined;

  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\" || isLineTerminator(char)) return undefined;
    if (char === quote) {
      return {
        value: source.slice(start + 1, index),
        end: index + 1,
      };
    }
    index += 1;
  }

  return undefined;
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined ? false : /\s/.test(char);
}

function lineCommentEndIndex(source: string, start: number): number {
  const newline = source.indexOf("\n", start);
  const carriageReturn = source.indexOf("\r", start);
  if (newline === -1) return carriageReturn;
  if (carriageReturn === -1) return newline;
  return Math.min(newline, carriageReturn);
}

function directiveStatementEndIndex(
  source: string,
  start: number,
): number | undefined {
  let index = start;

  while (index < source.length) {
    const char = source[index];
    if (char === ";") return index + 1;
    if (isLineTerminator(char)) return index + 1;
    if (isHorizontalWhitespace(char)) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const lineEnd = lineCommentEndIndex(source, index + 2);
      return lineEnd === -1 ? source.length : lineEnd + 1;
    }
    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd === -1) return undefined;
      const comment = source.slice(index, commentEnd + 2);
      if (hasLineTerminator(comment)) return commentEnd + 2;
      index = commentEnd + 2;
      continue;
    }
    return undefined;
  }

  return source.length;
}

function isHorizontalWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\v" || char === "\f";
}

function isLineTerminator(char: string | undefined): boolean {
  return (
    char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029"
  );
}

function hasLineTerminator(value: string): boolean {
  return /[\n\r\u2028\u2029]/.test(value);
}
