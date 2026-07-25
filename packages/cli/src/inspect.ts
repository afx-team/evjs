import type {
  InspectDiagnostic,
  InspectFrameworkBuildResult,
} from "@evjs/ev/_internal/build";

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
    lines.push(`  routingMode: ${result.routing.routingMode}`);
    lines.push(`  pageRoot: ${result.routing.pageRoot}`);
    lines.push(`  document.template: ${result.routing.document.template}`);
    lines.push(`  document.mount: ${result.routing.document.mount}`);
    if (result.routing.rootModule) {
      lines.push(`  rootModule: ${result.routing.rootModule}`);
    }
  } else {
    lines.push("  (disabled)");
  }
  lines.push("");

  appendList(lines, "Page Routes", result.pageRoutes, (route) => {
    return `${route.path} -> ${formatCoreIdentifier(route.id)} (${route.module})`;
  });

  appendList(lines, "Route Files", result.routeFiles, (file) => {
    const diagnostics = file.diagnostics
      ?.map((diagnostic) => ` ${formatDiagnostic(diagnostic)}`)
      .join("");
    const target = formatRouteFileTarget(file);
    return `${file.status}: ${file.file}${target}${diagnostics ?? ""}`;
  });

  appendList(
    lines,
    "Applications",
    Object.values(result.graph.applications),
    (application) =>
      `${application.id}: ${application.routingMode}, pages=${application.pageIds.length}, routes=${application.routeIds.length}, documents=${application.documentIds.length}`,
  );

  appendList(lines, "Pages", Object.values(result.graph.pages), (page) => {
    const extensions = Object.keys(page.extensions);
    const metadata = [
      `application=${page.applicationId}`,
      `render=${page.render}`,
      `scope=${formatPageScope(page.source.scope)}`,
      page.hydrate ? `hydrate=${page.hydrate}` : undefined,
      page.componentModel === "rsc" ? "rsc=true" : undefined,
      page.ppr ||
      (typeof page.prerender === "object" && page.prerender.partial === true)
        ? "ppr=true"
        : undefined,
      extensions.length > 0 ? `extensions=${extensions.join(",")}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    return `${page.id}: ${metadata} (${page.source.module})`;
  });

  appendList(lines, "Routes", result.graph.routes, formatCoreRoute);

  appendList(
    lines,
    "Documents",
    Object.values(result.graph.documents),
    (document) =>
      `${document.id}: application=${document.applicationId}, owner=${document.owner.kind}, output=${document.output}`,
  );

  appendList(
    lines,
    "Extensions",
    Object.entries(result.graph.extensions.namespaces),
    ([namespace, registration]) => {
      const metadata = [
        `producer=${formatCoreIdentifier(registration.producer)}`,
        `owners=${registration.owners.join(",")}`,
        registration.schemaVersion
          ? `schema=${registration.schemaVersion}`
          : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      return `${namespace}: ${metadata}`;
    },
  );

  appendList(lines, "Server Functions", result.graph.serverFunctions, (fn) => {
    return `${fn.exportName} -> ${fn.id} (${fn.module})`;
  });

  appendList(lines, "Server Routes", result.graph.serverRoutes, (route) => {
    return `${route.path} [${route.methods.join(", ")}] (${route.module})`;
  });

  lines.push("Runtime");
  lines.push(`  output.client: ${result.output.client}`);
  lines.push(`  output.server: ${result.output.server}`);
  if (result.bundler) {
    lines.push(`  bundler: ${result.bundler.name}`);
    lines.push(
      `  bundler.build: ${formatCapabilities(result.bundler.capabilities.build)}`,
    );
    lines.push(
      `  bundler.dev: ${formatCapabilities(result.bundler.capabilities.dev)}`,
    );
    for (const gap of result.bundler.gaps) {
      lines.push(`  bundler.gap: ${gap.capability} (${gap.reason})`);
    }
  }
  lines.push(`  server.basePath: ${result.runtime.server.basePath}`);
  lines.push(`  server.fn: ${result.runtime.server.fn}`);
  lines.push(`  server.ppr: ${result.runtime.server.ppr}`);
  if (result.runtime.server.rsc) {
    lines.push(`  server.rsc: ${result.runtime.server.rsc}`);
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
      const aliases = document.aliases?.length
        ? ` (aliases: ${document.aliases.join(", ")})`
        : "";
      return `${document.id}: ${document.fileName}${aliases}`;
    });
  }

  appendList(lines, "Diagnostics", result.diagnostics, formatDiagnostic);
  lines.push(`File Dependencies: ${result.fileDependencies.length}`);
  lines.push(`Plugin Watch Files: ${result.pluginWatchFiles.length}`);

  return `${lines.join("\n")}\n`;
}

function formatCapabilities(capabilities: object): string {
  return Object.entries(capabilities)
    .map(([name, supported]) => `${name}=${supported === true ? "yes" : "no"}`)
    .join(", ");
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
  let position: string | undefined;
  if (diagnostic.line !== undefined) {
    position =
      diagnostic.column === undefined
        ? String(diagnostic.line)
        : `${diagnostic.line}:${diagnostic.column}`;
  }
  const location = [diagnostic.file, position].filter(Boolean).join(":");
  const prefix = `[${diagnostic.level}] ${diagnostic.source}`;
  return location
    ? `${prefix} ${location} - ${diagnostic.message}`
    : `${prefix} - ${diagnostic.message}`;
}

type CoreRoute = InspectFrameworkBuildResult["graph"]["routes"][number];
type InspectPageScope =
  InspectFrameworkBuildResult["graph"]["pages"][string]["source"]["scope"];
type InspectRouteFile = InspectFrameworkBuildResult["routeFiles"][number];

function formatRouteFileTarget(file: InspectRouteFile): string {
  if (file.status === "route") {
    return ` -> ${file.routePath} (${file.routeId})`;
  }
  if (file.status === "facet") {
    const routePath = file.routePath ? ` ${file.routePath}` : "";
    return ` -> ${file.facetKind}${routePath}`;
  }
  return "";
}

function formatPageScope(scope: InspectPageScope): string {
  return scope.kind === "directory" ? scope.root : scope.file;
}

function formatCoreRoute(route: CoreRoute): string {
  const pattern = formatCoreRoutePattern(route.pattern.segments);
  const parent = route.parentId
    ? `, parent=${formatCoreIdentifier(route.parentId)}`
    : "";
  const facets = formatCoreRouteFacets(route);
  return `client:${formatCoreIdentifier(route.id)}: ${pattern} -> ${formatCoreRouteTarget(route)}${parent}${facets ? `, ${facets}` : ""}`;
}

function formatCoreIdentifier(value: string): string {
  const providerPrefix = "@evjs/provider/";
  if (!value.startsWith(providerPrefix)) return value;
  const identifier = value.slice(providerPrefix.length);
  const separator = identifier.indexOf(":");
  return separator === -1 ? "framework" : identifier.slice(separator + 1);
}

function formatCoreRouteFacets(route: CoreRoute): string {
  const facets: string[] = [];
  if (route.facets.layout === false) {
    facets.push("layout=false");
  } else if (route.facets.layout) {
    facets.push(`layout=${route.facets.layout}`);
  }
  if (route.facets.error) facets.push(`error=${route.facets.error}`);
  if (route.facets.notFound) {
    facets.push(`notFound=${route.facets.notFound}`);
  }
  if (route.facets.wrappers.length > 0) {
    facets.push(`wrappers=${route.facets.wrappers.join(",")}`);
  }
  return facets.join(", ");
}

function formatCoreRoutePattern(
  segments: CoreRoute["pattern"]["segments"],
): string {
  if (segments.length === 0) return "/";
  return `/${segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `:${segment.name}`;
      return `*${segment.name}`;
    })
    .join("/")}`;
}

function formatCoreRouteTarget(route: CoreRoute): string {
  if (route.target.kind === "page") return `page:${route.target.pageId}`;
  if (route.target.kind === "group") return "group";
  if (route.target.to.kind === "url") {
    return `redirect:${route.target.to.href}`;
  }
  return `redirect:${formatCoreRoutePattern(route.target.to.pattern.segments)}`;
}
