# 插件实践

这些小型示例建立在[插件开发](./plugin-authoring)与[插件生命周期钩子](./plugin-hooks)
之上。生成模块、组合入口、包装页面、添加中间件或 HTML 标签，以及修改模块解析时，
请使用[生成代码](./generated-contributions)。

## 添加部署元数据

部署适配器需要写入插件专属元数据时，使用 `transformOutput()`：

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

`transformOutput()` 只能修改已关联的 `AssetGroup` 内容与 `deployment` 元数据。框架
保留字段见[插件生命周期钩子](./plugin-hooks)中的构建产物说明。部署元数据只能包含普通、
可无损序列化为 JSON 的值；evjs 会在每次输出转换后进行校验。

## 添加页面元数据

使用 `ctx.owner.kind` 定位页面对应的文档：

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

静态 HTML 文件和页面专属的请求时文档外壳都会经过 `transformHtml()`。不要根据文件名
猜测文档归属。

## 添加 CSP nonce

`transformHtml()` 提供与构建器无关、已经解析的文档对象：

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

生产环境的 CSP 响应头必须使用与文档转换相同的 nonce。该值如何传递取决于部署运行时。
