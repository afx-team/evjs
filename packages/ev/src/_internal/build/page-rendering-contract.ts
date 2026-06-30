import type {
  ComponentModel,
  HydrationMode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
} from "@evjs/shared/manifest";

export interface PageRenderingContract {
  render?: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: HydrationMode;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}

export interface PageBuildContract extends PageRenderingContract {
  component?: string;
}

export interface ValidatePageRenderingContractOptions {
  requireExplicitRenderForFullPrerender?: boolean;
}

export function validatePageRenderingContract(
  label: string,
  page: PageRenderingContract,
  options: ValidatePageRenderingContractOptions = {},
): void {
  const violation = getPageRenderingContractViolation(label, page, options);
  if (violation) throw new Error(`[evjs] ${violation}`);
}

export function validatePageBuildContract(
  label: string,
  page: PageBuildContract,
): void {
  const violation = getPageBuildContractViolation(label, page);
  if (violation) throw new Error(`[evjs] ${violation}`);
}

export function getPageRenderingContractViolation(
  label: string,
  page: PageRenderingContract,
  options: ValidatePageRenderingContractOptions = {},
): string | undefined {
  const rsc = isRscPage(page);
  const partial = isPartialPrerenderPage(page);
  const fullPrerender = isFullPrerenderPage(page);
  const missingFullPrerenderRender =
    options.requireExplicitRenderForFullPrerender === true &&
    page.render === undefined;

  if (fullPrerender && (page.render === "csr" || missingFullPrerenderRender)) {
    return `${label} uses full prerendering and must declare render: "ssg" or "ssr".`;
  }
  if (rsc && page.render !== "ssr") {
    return `${label} uses RSC and must declare render: "ssr".`;
  }
  if (rsc && page.hydrate !== undefined && page.hydrate !== "none") {
    return `${label} uses RSC and must omit hydrate or declare hydrate: "none".`;
  }
  if (partial && page.render !== "ssr") {
    return `${label} uses partial prerendering and must declare render: "ssr".`;
  }
  if (rsc && partial) {
    return `${label} combines RSC and partial prerendering, which is not supported yet. Choose either rsc: true or prerender: { partial: true }, or split them into separate page routes.`;
  }
  return undefined;
}

export function getPageBuildContractViolation(
  label: string,
  page: PageBuildContract,
): string | undefined {
  const rsc = isRscPage(page);
  const partial = isPartialPrerenderPage(page);

  if (rsc && !page.component) {
    return `${label} uses RSC but does not declare a component page module.`;
  }
  if (partial && !page.component) {
    return `${label} uses partial prerendering but does not declare a component page module.`;
  }

  const renderingViolation = getPageRenderingContractViolation(label, page);
  if (renderingViolation) return renderingViolation;
  return undefined;
}

export function isRscPage(page: { componentModel?: ComponentModel }): boolean {
  return page.componentModel === "rsc";
}

export function isPartialPrerenderPage(page: {
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}): boolean {
  return (
    (typeof page.prerender === "object" && page.prerender.partial === true) ||
    Boolean(page.ppr)
  );
}

export function isFullPrerenderPage(page: {
  render?: RenderMode;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}): boolean {
  if (page.render === "ssg") return true;
  if (!page.prerender || isPartialPrerenderPage(page)) return false;
  return true;
}
