import { assertPortableRelativeBrowserArtifactPath } from "@evjs/shared/manifest";

/** Validate client asset templates shared by the bundled adapters. */
export function resolveOutputFilename(
  value: unknown,
  field:
    | "output.filename"
    | "output.chunkFilename"
    | "output.cssFilename"
    | "output.cssChunkFilename",
): string {
  const extension =
    field === "output.cssFilename" || field === "output.cssChunkFilename"
      ? ".css"
      : ".js";
  if (typeof value !== "string" || !value.endsWith(extension)) {
    throw new Error(
      `[evjs] ${field} must be a static relative ${extension} filename template.`,
    );
  }
  const placeholder = /\[(?:name|contenthash(?::[1-9][0-9]*)?)\]/g;
  const path = value.replace(placeholder, "artifact");
  if (/[[\]]/.test(path)) {
    throw new Error(
      `[evjs] ${field} only supports [name], [contenthash], and [contenthash:N] placeholders.`,
    );
  }
  assertPortableRelativeBrowserArtifactPath(path, field);
  if (
    field === "output.filename"
      ? !value.includes("[name]")
      : !placeholder.test(value)
  ) {
    throw new Error(
      `[evjs] ${field} must include ${field === "output.filename" ? "[name] to distinguish entries" : "[name] or [contenthash] to distinguish assets"}.`,
    );
  }
  return value;
}
