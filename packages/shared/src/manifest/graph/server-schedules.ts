import type { ServerScheduleNode } from "../contracts.js";

export function assertServerScheduleNodes(
  value: unknown,
  source: string,
): asserts value is ServerScheduleNode[] {
  if (!Array.isArray(value))
    throw new Error(`[evjs] ${source} must be an array.`);
  const ids = new Set<string>();
  value.forEach((node: unknown, index) => {
    const label = `${source}[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node))
      throw new Error(`[evjs] ${label} must be an object.`);
    const task = node as Record<string, unknown>;
    for (const key of ["id", "module", "exportName", "cron"]) {
      if (
        typeof task[key] !== "string" ||
        !task[key] ||
        task[key] !== task[key].trim()
      )
        throw new Error(
          `[evjs] ${label}.${key} must be a non-empty string without surrounding whitespace.`,
        );
    }
    if (typeof task.disable !== "boolean")
      throw new Error(`[evjs] ${label}.disable must be a boolean.`);
    for (const key of ["line", "column"]) {
      if (
        task[key] !== undefined &&
        (!Number.isInteger(task[key]) || (task[key] as number) < 1)
      )
        throw new Error(`[evjs] ${label}.${key} must be a positive integer.`);
    }
    if (ids.has(task.id as string))
      throw new Error(`[evjs] ${label}.id "${task.id}" must be unique.`);
    ids.add(task.id as string);
  });
}
