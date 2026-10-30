import type { CliFlags, CliFlagValue } from "@evjs/ev/plugin";

/** Converts dash-separated CLI flag names to camelCase context keys. */
function toFlagName(rawName: string): string {
  return rawName.replace(/-([a-zA-Z0-9])/g, (_, char: string) =>
    char.toUpperCase(),
  );
}

/** Converts boolean-like flag values while preserving other strings. */
function coerceFlagValue(value: string): boolean | string {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/** Stores a flag value, preserving repeated flags as an ordered array. */
function setFlag(
  flags: Record<string, CliFlagValue>,
  name: string,
  value: boolean | string,
): void {
  const hasCurrent = Object.hasOwn(flags, name);
  const current = hasCurrent ? flags[name] : undefined;
  if (!hasCurrent || current === undefined) {
    flags[name] = value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    flags[name] = [current, value];
  }
}

/**
 * Parses extra command arguments into plugin-readable flag values.
 *
 * Supports boolean flags (`--mock`), equals values (`--target=local`),
 * space-separated values (`--target local`), camelCase keys for dashed names,
 * and repeated flags as arrays.
 */
export function parseCliFlags(args: readonly string[]): CliFlags {
  const flags = Object.create(null) as CliFlags;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") break;
    if (!arg?.startsWith("--") || arg === "--") continue;

    const rawFlag = arg.slice(2);
    if (!rawFlag) continue;

    const equalsIndex = rawFlag.indexOf("=");
    if (equalsIndex >= 0) {
      const name = toFlagName(rawFlag.slice(0, equalsIndex));
      if (!name) continue;
      setFlag(flags, name, coerceFlagValue(rawFlag.slice(equalsIndex + 1)));
      continue;
    }
    const nextArg = args[index + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      setFlag(flags, toFlagName(rawFlag), coerceFlagValue(nextArg));
      index++;
    } else {
      setFlag(flags, toFlagName(rawFlag), true);
    }
  }

  return flags;
}
