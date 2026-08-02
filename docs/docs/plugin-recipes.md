# Plugin Recipes

These focused recipes build on [Plugin Authoring](./plugin-authoring) and
[Plugin Hooks](./plugin-hooks). For generated modules, entry composition,
wrappers, middleware, HTML tags, and resolution changes, use
[Generated Contributions IR](./generated-contributions).

## Add Deployment Metadata

Use `transformOutput()` when a deployment adapter needs plugin-owned metadata:

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const deployMetadata = definePlugin({
  id: "deploy-metadata",
  setup() {
    return {
      transformOutput(output) {
        output.deployment = {
          platform: "custom",
          builtAt: new Date().toISOString(),
        };
      },
    };
  },
});
```

`transformOutput()` can change only linked `AssetGroup` contents and `deployment`
metadata. See [Build Output Ownership](./plugin-hooks#build-output-ownership)
for the framework-owned fields. Deployment metadata must contain only plain,
losslessly JSON-serializable values; evjs validates it after every output hook.

## Add Per-Page Metadata

Use `ctx.owner.kind` to target Page-owned documents:

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const pageMetadata = definePlugin({
  id: "page-metadata",
  setup() {
    return {
      transformHtml(doc, ctx) {
        if (ctx.owner.kind !== "page") return;
        const meta = doc.createElement("meta");
        meta.setAttribute("name", "evjs-page");
        meta.setAttribute("content", ctx.owner.pageId);
        doc.head?.appendChild(meta);
      },
    };
  },
});
```

Static HTML files and Page-specific request-time document shells both pass
through `transformHtml()`. Do not infer ownership from the filename.

## Add a CSP Nonce

`transformHtml()` exposes a parsed, bundler-independent document:

```ts
import crypto from "node:crypto";
import { definePlugin } from "@evjs/ev/plugin";

export const cspNonce = definePlugin({
  id: "csp-nonce",
  setup() {
    return {
      transformHtml(doc) {
        const nonce = crypto.randomBytes(16).toString("base64");
        for (const script of doc.querySelectorAll("script")) {
          script.setAttribute("nonce", nonce);
        }
      },
    };
  },
});
```

For production CSP, ensure the response header uses the same nonce as the
document transformation. The mechanism for carrying that value depends on the
deployment runtime.
