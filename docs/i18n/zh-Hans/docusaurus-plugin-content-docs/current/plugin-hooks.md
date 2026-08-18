# 插件 Hooks

插件 Hook 用于构建时副作用、HTML 修改、最终部署文件和底层构建器定制。共享状态放在 `setup()` 中，只返回真正需要的 Hook。

插件需要增加模块，或把代码挂到页面/入口时，使用[生成代码](./generated-contributions)。生成式贡献比 Hook 写临时文件更容易检查与组合。

## 生命周期概览

```mermaid
flowchart LR
  Configure["configure"] --> Setup["setup"]
  Setup --> Generate["emitIR / emitPageIR"]
  Generate --> Bundler["configureBundler"]
  Bundler --> Build["bundle"]
  Build --> Before["beforeBuild"]
  Before --> Output["transformOutput"]
  Output --> HTML["transformHtml"]
  HTML --> After["afterBuild"]
  After --> Dispose["dispose"]
```

`configure()` 和 `setup()` 见[插件开发](./plugin-authoring)。通过 `definePlugin()` 创建的插件以 `ctx.options` 获得类型化应用选项。

| Hook | 用途 |
| --- | --- |
| `configureBundler(config, ctx)` | 适配器专属 Loader、解析、优化或其他底层设置 |
| `devServerReady({ origin, signal })` | 客户端监听可用后连接开发工具 |
| `beforeBuild(ctx)` | 在输出完成前，启动依赖最新打包结果的工作 |
| `transformOutput(output, ctx)` | 调整资源组或增加部署元信息 |
| `transformHtml(document, ctx)` | 修改一份生成 HTML 或请求时文档外壳 |
| `afterBuild(result)` | 输出平台文件或报告已完成构建 |
| `dispose(ctx)` | 释放 `setup()` 或开发 Hook 创建的资源 |

## 在 `setup()` 中保存状态

长期资源只创建一次，并在 `dispose()` 中关闭：

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const reporter = definePlugin({
  id: "reporter",
  setup(ctx) {
    const client = createReporter(ctx.options);

    return {
      afterBuild({ deploymentMetadata, isRebuild }) {
        client.record({ deploymentMetadata, isRebuild });
      },
      async dispose() {
        await client.close();
      },
    };
  },
});
```

每次成功 Setup 的 `dispose()` 最多执行一次，并按插件逆序执行。即使前置工作只完成了一部分，清理也应保持安全。

## 监听插件输入

`setup()`、`emitIR()` 和 `configureBundler()` 上下文提供 `addWatchFile()`，用于影响插件行为的项目本地文件：

```ts
setup(ctx) {
  ctx.addWatchFile("./config/analytics.json");
}
```

监听输入变化时，evjs 会按需刷新开发环境。生成代码依赖的数据应在 `emitIR()` 中读取，使代码随输入变化。不要监听生成的 `.ev` 或 `dist` 文件。

## 开发服务器就绪

外部工具需要真实客户端来源时使用 `devServerReady()`：

```ts
setup() {
  let closeTools: (() => Promise<void>) | undefined;

  return {
    async devServerReady({ origin, signal }) {
      const tools = await connectDevTools({ origin, signal });
      closeTools = () => tools.close();
    },
    async dispose() {
      await closeTools?.();
    },
  };
}
```

- `origin` 是活动构建器报告的监听地址。
- 开发环境开始关闭时，`signal` 会 Abort。
- 转发或观察 Signal，并让异步工作及时结束。
- 此 Hook 仅在开发中运行，不代表第一份应用产物或服务端运行时已经就绪。

依赖产物的工作请放在 `afterBuild()`。

## 构建与重构建 Hook

只有打包生成有效输出周期时才执行 `beforeBuild()` 与 `afterBuild()`；`prepare` 和 `inspect` 不会调用。

开发环境中：

- 首次成功输出使用 `isRebuild: false`；
- 后续成功输出周期使用 `isRebuild: true`；
- 失败周期不调用 `afterBuild()`。

`afterBuild()` 在规范文件发布后运行。该 Hook 抛错仍会让生产构建失败，因此它适合必需产物；可选上报失败应由插件自行处理。

## 转换构建产物

`transformOutput()` 可以调整已连接的资源组内容，并增加插件部署元信息。部署元信息必须是可无损序列化的普通 JSON。

不要用输出 Hook 重命名页面、路由、文档、运行时路径或框架输出目录。这些选择属于应用配置、页面配置或声明式生成贡献。

## 转换 HTML

`transformHtml()` 接收一份解析后的 `HtmlDocument` 及其上下文：

```ts
transformHtml(document, ctx) {
  document.head?.appendChild(
    document.createComment(` build ${ctx.buildId} `),
  );

  if (ctx.owner.kind === "page") {
    document.documentElement?.setAttribute(
      "data-page",
      ctx.owner.pageId,
    );
  }
}
```

常用上下文字段包括：

- `documentId`、`applicationId`、`fileName` 与 `template`；
- 标识应用、页面或插件文档的 `owner`；
- `assets`、`buildId` 与 `publicPath`；
- 供高级检查使用的当前输出。

应根据 `owner.kind` 分支，不要从文件名猜所有权。文档类型从公共插件入口导入：

```ts
import type { HtmlDocument } from "@evjs/ev/plugin";
```

简单 `meta`、`link`、`script` 或 `style` 增加应优先使用[生成代码](./generated-contributions)中的声明式 `html.tag` Slot。

## 使用最终构建结果

`afterBuild()` 为常见部署工作提供聚焦值：

```ts
setup() {
  return {
    afterBuild({ deploymentMetadata, frameworkRuntime, isRebuild }) {
      writePlatformManifest({
        assets: deploymentMetadata.assets,
        routes: deploymentMetadata.routes,
        server: deploymentMetadata.server,
        runtime: frameworkRuntime,
        isRebuild,
      });
    },
  };
}
```

路由、文档、资源和服务端入口优先使用 `deploymentMetadata`。只有插件确实需要部署投影中没有的构建时资源细节时，才使用更宽的 `output`。

## 配置构建器

`definePlugin()` 默认与构建器无关。底层类型化修改使用适配器 Helper，每个 Helper 只为自己的适配器执行。

Utoopack 示例：

```ts
import { merge, utoopack } from "@evjs/bundler-utoopack";
import { definePlugin } from "@evjs/ev/plugin";

export const yamlPlugin = definePlugin({
  id: "yaml-support",
  setup() {
    return {
      configureBundler: utoopack((config) => {
        merge(config, {
          module: {
            rules: {
              ".yaml": { type: "json" },
            },
          },
        });
      }),
    };
  },
});
```

Webpack 示例：

```ts
import { webpack } from "@evjs/bundler-webpack";

configureBundler: webpack((configs) => {
  for (const config of configs) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["@app"] = "./src";
  }
});
```

构建器 Hook 可以修改受支持的底层设置，但不能替换框架页面入口或客户端/服务端输出目录。改变启动组合请使用生成式贡献。

## 贡献终端快捷键

交互快捷键是 Descriptor 声明，不是生命周期 Hook：

```ts
const tools = definePlugin({
  id: "tools",
  cliShortcuts() {
    return [
      {
        key: "u",
        description: "show dev url",
        action(session) {
          console.log(session.origin);
        },
      },
    ];
  },
});
```

Key 必须是单个非空白字符。Action 获得当前客户端 `origin` 和关闭完整 `ev dev` 运行的 `close()`。应用端控制见[本地开发](./dev#交互式快捷键)。

小型完整示例见[插件配方](./plugin-recipes)。
