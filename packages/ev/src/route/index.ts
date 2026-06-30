/**
 * Route data APIs for evjs file-convention applications.
 */

export type { PageProps } from "./context.js";
export {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "./context.js";
// biome-ignore lint/suspicious/noEmptyInterface: Generated page route types augment this interface.
export interface Register {}
export type {
  CreatePageRouteRegister,
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
  PageRouteTypeDefinition,
  PageRouteTypeDefinitions,
} from "./types.js";
