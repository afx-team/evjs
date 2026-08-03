import type { BuildOutput } from "@evjs/shared/manifest";
import type {
  HtmlDocument,
  HtmlDocumentInfo,
  PluginHooks,
  PluginSetupContext,
} from "../../plugin/index.js";
import { createBuildResult } from "./build-result.js";
import { createLatePluginContext } from "./plugin-lifecycle.js";

export interface BuildHtmlOptions<TBundlerCfg = unknown> {
  /** Pre-parsed HTML document (from `generateHtml()`). */
  doc: HtmlDocument;
  hooks: PluginHooks<TBundlerCfg>[];
  /** Base plugin context shared by HTML hooks. */
  pluginContext: PluginSetupContext<TBundlerCfg>;
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
 * `generateHtml()` from `@evjs/ev/_internal/build` and pass the resulting
 * doc here for:
 *
 * 1. `transformHtml` plugin hooks (applied in sequence).
 * 2. Serialization to the final HTML string.
 */
export async function buildHtml<TBundlerCfg = unknown>(
  options: BuildHtmlOptions<TBundlerCfg>,
): Promise<string> {
  const { doc, hooks, html, output, pluginContext } = options;
  const latePluginContext = createLatePluginContext(pluginContext);

  // The DOM composes across hooks, while manifest data is an isolated
  // observation. A transform must never be able to redirect later framework
  // writes or leak an in-place manifest mutation into another plugin.
  for (const h of hooks) {
    if (h.transformHtml) {
      const outputSnapshot = structuredClone(output);
      const htmlSnapshot = structuredClone(html);
      const buildResult = createBuildResult(
        outputSnapshot,
        options.isRebuild ?? false,
      );
      const htmlContext = Object.freeze({
        ...latePluginContext,
        ...htmlSnapshot,
        ...buildResult,
        buildId: outputSnapshot.buildId,
        publicPath: outputSnapshot.publicPath,
      });
      await h.transformHtml(doc, htmlContext);
    }
  }

  return doc.toString();
}
