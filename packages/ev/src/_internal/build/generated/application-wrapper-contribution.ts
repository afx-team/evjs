import type {
  ApplicationWrapperSlotPlanItem,
  BuildPlan,
  GeneratedFrameworkPlan,
} from "@evjs/shared/manifest";

/** Project Application-root wrappers onto matching generated CSR entries. */
export function applyApplicationWrapperContributions(
  plan: BuildPlan,
  generated: Pick<GeneratedFrameworkPlan, "slots">,
): void {
  const contributions = generated.slots.filter(
    (item): item is ApplicationWrapperSlotPlanItem =>
      item.slot === "application.wrapper",
  );
  if (contributions.length === 0) return;

  const projectionCounts = new Map(
    contributions.map((contribution) => [contribution.key, 0]),
  );

  for (const entry of plan.entries) {
    if (entry.metadata?.type !== "pages-app") continue;
    const applicationId = entry.owner?.appId;
    const matches = contributions.filter(
      (contribution) =>
        contribution.target?.applicationId === undefined ||
        contribution.target.applicationId === applicationId,
    );
    if (matches.length === 0) continue;

    // Metadata is outer-to-inner. As with page.wrapper, a later plugin
    // contribution wraps an earlier contribution.
    entry.metadata.wrappers = [
      ...(entry.metadata.wrappers ?? []),
      ...[...matches].reverse().map((contribution) => contribution.module),
    ];
    for (const contribution of matches) {
      projectionCounts.set(
        contribution.key,
        (projectionCounts.get(contribution.key) ?? 0) + 1,
      );
    }
  }

  for (const contribution of contributions) {
    if ((projectionCounts.get(contribution.key) ?? 0) > 0) continue;
    const target = contribution.target?.applicationId
      ? `Application "${contribution.target.applicationId}"`
      : "any Application";
    throw new Error(
      `[evjs] Plugin "${contribution.pluginId}" application.wrapper contribution "${contribution.id}" targets ${target}, but no client CSR Application runtime projection exists for that target.`,
    );
  }
}
