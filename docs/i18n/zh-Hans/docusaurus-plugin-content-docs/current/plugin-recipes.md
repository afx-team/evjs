# 插件配方

这些聚焦配方建立在[插件开发](./plugin-authoring)与[插件 Hooks](./plugin-hooks)之上。
生成模块、entry composition、wrapper、middleware、HTML tag 与 resolution 变更应使用
[Generated Contributions IR](./generated-contributions)。

## 添加 Deployment Metadata

Deployment adapter 需要 plugin-owned metadata 时，使用 `buildOutput()`：

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const deployMetadata = definePlugin({
  id: "deploy-metadata",
  setup() {
    return {
      buildOutput(output) {
        output.deployment = {
          platform: "custom",
          builtAt: new Date().toISOString(),
        };
      },
    };
  },
});
```

`buildOutput()` 只能修改 linked `AssetGroup` 内容与 `deployment` metadata。框架持有
字段见[插件 Hooks](./plugin-hooks)中的 Build Output 所有权说明。Deployment metadata
只能包含普通、可无损 JSON 序列化的值；evjs 会在每个 output hook 后进行校验。

## 添加 Page Metadata

使用 `ctx.owner.kind` 定位 Page-owned document：

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

Static HTML file 与 Page-specific request-time document shell 都会经过
`transformHtml()`。不要从文件名推断 ownership。

## 添加 CSP Nonce

`transformHtml()` 暴露解析后的 bundler-independent document：

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

生产环境的 CSP response header 必须使用与 document transform 相同的 nonce。该值的
传递机制取决于 deployment runtime。
