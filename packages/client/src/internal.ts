/**
 * Framework-only client runtime APIs used by evjs generated entries.
 *
 * Application code should import page hooks, navigation, transport, and remote
 * helpers from `@evjs/client` instead.
 */

export type {
  CreatePagesAppOptions,
  PageDefinition,
  PageModule,
  PageProviderProps,
  PagesApp,
  RootLayoutModule,
} from "./page-route.js";
export { createPagesApp, PageProvider } from "./page-route.js";
