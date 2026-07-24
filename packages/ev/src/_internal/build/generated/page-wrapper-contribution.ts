import type {
  BuildPlan,
  ContributionTarget,
  CoreGraph,
  GeneratedFrameworkPlan,
  PageWrapperSlotPlanItem,
} from "@evjs/shared/manifest";

/**
 * Project one semantic Page wrapper declaration onto every matching concrete
 * client/server Page materialization.
 */
export function applyPageWrapperContributions(
  plan: BuildPlan,
  graph: CoreGraph,
  generated: GeneratedFrameworkPlan,
): void {
  const contributions = generated.slots.filter(
    (item): item is PageWrapperSlotPlanItem => item.slot === "page.wrapper",
  );
  if (contributions.length === 0) return;

  const projectionCounts = new Map(
    contributions.map((contribution) => [contribution.key, 0]),
  );
  const matchingContributions = (
    pageId: string,
    runtime: "client" | "server",
  ) =>
    contributions.filter(
      (contribution) =>
        contribution.runtime !== (runtime === "client" ? "server" : "client") &&
        targetMatchesPage(contribution.target, graph, pageId),
    );
  const recordProjection = (matches: PageWrapperSlotPlanItem[]) => {
    for (const contribution of matches) {
      projectionCounts.set(
        contribution.key,
        (projectionCounts.get(contribution.key) ?? 0) + 1,
      );
    }
  };
  // Entry metadata is outer-to-inner. Contributions use component-transform
  // order, so a later declaration wraps an earlier declaration.
  const contributedLayers = (matches: PageWrapperSlotPlanItem[]) =>
    [...matches].reverse().map((contribution) => ({
      kind: "wrapper" as const,
      module: contribution.module,
    }));

  for (const entry of plan.entries) {
    if (entry.metadata?.type === "pages-app") {
      for (const route of entry.metadata.routes) {
        if (route.target?.kind !== "page") continue;
        const matches = matchingContributions(route.target.pageId, "client");
        if (matches.length === 0) continue;
        route.wrappers = [
          ...(route.wrappers ?? []),
          ...contributedLayers(matches).map((layer) => layer.module),
        ];
        recordProjection(matches);
      }
      continue;
    }

    const pageId = entry.owner?.pageId;
    if (!pageId) continue;
    if (entry.metadata?.type === "react-component-page") {
      const matches = matchingContributions(pageId, "client");
      if (matches.length === 0) continue;
      entry.metadata.layers = [
        ...(entry.metadata.layers ?? []),
        ...contributedLayers(matches),
      ];
      recordProjection(matches);
      continue;
    }
    if (entry.metadata?.type === "react-server-page") {
      const matches = matchingContributions(pageId, "server");
      if (matches.length === 0) continue;
      entry.metadata.layers = [
        ...(entry.metadata.layers ?? []),
        ...contributedLayers(matches),
      ];
      recordProjection(matches);
    }
  }

  for (const renderer of plan.server.renderers ?? []) {
    const pageId = renderer.owner?.pageId;
    if (!pageId || renderer.metadata?.type !== "react-server-page") continue;
    const matches = matchingContributions(pageId, "server");
    if (matches.length === 0) continue;
    renderer.metadata.layers = [
      ...(renderer.metadata.layers ?? []),
      ...contributedLayers(matches),
    ];
  }

  for (const contribution of contributions) {
    if ((projectionCounts.get(contribution.key) ?? 0) > 0) continue;
    const target = contribution.target
      ? describeTarget(contribution.target)
      : "any Page";
    const runtime =
      contribution.runtime === "all"
        ? "client or server"
        : contribution.runtime;
    throw new Error(
      `[evjs] Plugin "${contribution.pluginName}" page.wrapper contribution "${contribution.id}" targets ${target}, but no ${runtime} Page runtime projection exists for that target.`,
    );
  }
}

function targetMatchesPage(
  target: ContributionTarget | undefined,
  graph: CoreGraph,
  pageId: string,
): boolean {
  if (!target) return true;
  if (target.kind === "page") return target.pageId === pageId;
  const page = graph.pages[pageId];
  return Boolean(
    page &&
      (target.applicationId === undefined ||
        target.applicationId === page.applicationId),
  );
}

function describeTarget(target: ContributionTarget): string {
  if (target.kind === "page") {
    return `Page "${target.pageId}"`;
  }
  return target.applicationId
    ? `Application "${target.applicationId}"`
    : "any Application";
}
