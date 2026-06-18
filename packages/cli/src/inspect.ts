import type { InspectDiagnostic, InspectFrameworkBuildResult } from "@evjs/ev";

export function hasInspectErrors(result: InspectFrameworkBuildResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.level === "error");
}

export function formatInspectJson(result: InspectFrameworkBuildResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatInspectText(result: InspectFrameworkBuildResult): string {
  const lines: string[] = [];
  lines.push("ev inspect");
  lines.push(`Project: ${result.cwd}`);
  lines.push(`Mode: ${result.command} (${result.mode})`);
  lines.push("");

  lines.push("Routing");
  if (result.routing) {
    lines.push(`  mode: ${result.routing.mode}`);
    lines.push(`  dir: ${result.routing.dir}`);
    lines.push(`  html: ${result.routing.html}`);
    lines.push(`  mount: ${result.routing.mount}`);
    lines.push(`  layout: ${formatValue(result.routing.layout ?? "auto")}`);
    if (result.routing.rootModule) {
      lines.push(`  rootModule: ${result.routing.rootModule}`);
    }
    if (result.routing.routeTypes) {
      lines.push(`  routeTypes: ${result.routing.routeTypes}`);
    }
  } else {
    lines.push("  (disabled)");
  }
  lines.push("");

  appendList(lines, "Page Routes", result.pageRoutes, (route) => {
    return `${route.path} -> ${route.id} (${route.module})`;
  });

  appendList(lines, "Route Files", result.routeFiles, (file) => {
    const diagnostics = file.diagnostics
      ?.map((diagnostic) => ` ${formatDiagnostic(diagnostic)}`)
      .join("");
    const target =
      file.status === "route" ? ` -> ${file.routePath} (${file.routeId})` : "";
    return `${file.status}: ${file.file}${target}${diagnostics ?? ""}`;
  });

  appendList(lines, "Pages", result.pages, (page) => {
    const model = [
      `render=${page.render}`,
      page.hydrate ? `hydrate=${page.hydrate}` : undefined,
      page.rsc ? "rsc=true" : undefined,
      page.partialPrerender ? "ppr=true" : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    const source = page.component ?? page.entry ?? page.app ?? "(generated)";
    return `${page.id}: ${model} (${source})`;
  });

  appendList(lines, "Server Functions", result.serverFunctions, (fn) => {
    return `${fn.exportName} -> ${fn.id} (${fn.module})`;
  });

  appendList(lines, "Server Routes", result.serverRoutes, (route) => {
    return `${route.path} [${route.methods.join(", ")}] (${route.module})`;
  });

  lines.push("Runtime");
  lines.push(`  serverEnabled: ${String(result.runtime.serverEnabled)}`);
  if (result.runtime.server) {
    lines.push(`  server.basePath: ${result.runtime.server.basePath}`);
    lines.push(`  server.fn: ${result.runtime.server.fn}`);
    lines.push(`  server.ppr: ${result.runtime.server.ppr}`);
    if (result.runtime.server.rsc) {
      lines.push(`  server.rsc: ${result.runtime.server.rsc}`);
    }
  }
  if (result.runtime.transport?.baseUrl) {
    lines.push(`  transport.baseUrl: ${result.runtime.transport.baseUrl}`);
  }
  lines.push("");

  if (result.buildPlan) {
    appendList(lines, "Build Entries", result.buildPlan.entries, (entry) => {
      return `${entry.name}: ${entry.kind}/${entry.environment}`;
    });
    appendList(lines, "HTML Documents", result.buildPlan.html, (document) => {
      return `${document.id}: ${document.fileName}`;
    });
  }

  appendList(lines, "Diagnostics", result.diagnostics, formatDiagnostic);
  lines.push(`File Dependencies: ${result.fileDependencies.length}`);
  lines.push(`Plugin Watch Files: ${result.pluginWatchFiles.length}`);

  return `${lines.join("\n")}\n`;
}

function appendList<T>(
  lines: string[],
  title: string,
  values: T[],
  format: (value: T) => string,
): void {
  lines.push(title);
  if (values.length === 0) {
    lines.push("  (none)");
  } else {
    for (const value of values) {
      lines.push(`  ${format(value)}`);
    }
  }
  lines.push("");
}

function formatDiagnostic(diagnostic: InspectDiagnostic): string {
  const location = [
    diagnostic.file,
    diagnostic.line === undefined
      ? undefined
      : diagnostic.column === undefined
        ? String(diagnostic.line)
        : `${diagnostic.line}:${diagnostic.column}`,
  ]
    .filter(Boolean)
    .join(":");
  const prefix = `[${diagnostic.level}] ${diagnostic.source}`;
  return location
    ? `${prefix} ${location} - ${diagnostic.message}`
    : `${prefix} - ${diagnostic.message}`;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
