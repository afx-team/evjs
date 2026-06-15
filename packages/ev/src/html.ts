import type { BuildOutput } from "@evjs/shared/manifest";
import type {
  HtmlDocument,
  HtmlDocumentInfo,
  PluginContext,
  PluginHooks,
} from "./config.js";
import { createBuildResult } from "./plugin.js";

export interface BuildHtmlOptions<TBundlerCfg = unknown> {
  /** Pre-parsed HTML document (from `generateHtml()`). */
  doc: HtmlDocument;
  hooks: PluginHooks<TBundlerCfg>[];
  /** Base plugin context shared by HTML hooks. */
  pluginContext: PluginContext<TBundlerCfg>;
  /** Current HTML document identity. */
  html: HtmlDocumentInfo;
  /** Single framework build output. */
  output: BuildOutput;
  /** True when this HTML is emitted for a dev rebuild/update. */
  isRebuild?: boolean;
}

/**
 * Apply framework-level HTML transforms to a pre-parsed document.
 *
 * This is bundler-agnostic — callers parse the initial HTML with
 * `generateHtml()` from `@evjs/ev/build-tools` and pass the resulting
 * doc here for:
 *
 * 1. `transformHtml` plugin hooks (applied in sequence).
 * 2. Serialization to the final HTML string.
 */
export async function buildHtml<TBundlerCfg = unknown>(
  options: BuildHtmlOptions<TBundlerCfg>,
): Promise<string> {
  const { doc, hooks, html, output, pluginContext } = options;

  // Run transformHtml plugin hooks in sequence (mutate doc in place)
  const buildResult = createBuildResult(output, options.isRebuild ?? false);
  const htmlContext = {
    ...pluginContext,
    ...html,
    ...buildResult,
    buildId: output.buildId,
    publicPath: output.publicPath,
  };
  for (const h of hooks) {
    if (h.transformHtml) {
      await h.transformHtml(doc, htmlContext);
    }
  }

  return doc.toString();
}
