# 插件 Hooks

插件通过 lifecycle hooks 处理构建期副作用与底层 bundler 定制。在 `setup()` 中定义共享
状态，并返回需要该状态的 hooks。如果行为应以声明方式记录在 framework IR 中，则改用
[generated contributions](./generated-contributions)。

## 生命周期

```mermaid
flowchart TB
  subgraph Configure["配置阶段"]
    AppOptions["解析类型安全的 Application options"]
    Config["config(config, ctx.options)"]
    Resolve["解析框架配置"]
    Setup["setup(ctx.options)"]
  end

  subgraph Plan["框架规划"]
    BuildStart["buildStart()"]
    Graph["discover graph\nroutes + server functions"]
    PageSettings["解析 Page plugin settings"]
    BuildPlan["create BuildPlan"]
    Contributions["contributions(ctx) / contributePage(ctx)\nmodules + slots"]
    IR["materialize .ev"]
  end

  subgraph Build["Bundling 和输出"]
    BundlerConfig["bundlerConfig()"]
    Bundler["bundler build"]
    BuildOutput["buildOutput()"]
    HTML["transformHtml()\nper document"]
    BuildEnd["buildEnd()"]
    Dispose["dispose()"]
  end

  AppOptions --> Config --> Resolve --> Setup --> BuildStart --> Graph --> PageSettings --> BuildPlan
  BuildPlan --> Contributions --> IR --> BundlerConfig --> Bundler
  Bundler --> BuildOutput --> HTML --> BuildEnd --> Dispose

  classDef config fill:#eef6ff,stroke:#8fb5e8,color:#102a43;
  classDef plan fill:#f3f0ff,stroke:#a78bfa,color:#2e1065;
  classDef build fill:#ecfdf5,stroke:#34d399,color:#064e3b;
  class AppOptions,Config,Resolve,Setup config;
  class BuildStart,Graph,PageSettings,BuildPlan,Contributions,IR plan;
  class BundlerConfig,Bundler,BuildOutput,HTML,BuildEnd,Dispose build;
```

通过 `definePlugin()` 创建插件时，类型安全的值在这些阶段保持扁平：config 与 setup
使用 `ctx.options`；`contributions()` 使用 `ctx.options` 和
`ctx.pages[].options`；`contributePage()` 使用 `ctx.options` 与
`ctx.pageOptions`。

| Hook | 用途 |
|------|------|
| `buildStart(ctx)` | 路由发现前针对当前 session/config snapshot 的准备 |
| `bundlerConfig(config, ctx)` | 修改当前 bundler 配置 |
| `buildOutput(output, ctx)` | 调整已链接的 `AssetGroup` 内容或添加 deployment metadata |
| `transformHtml(doc, ctx)` | 逐个 HTML 文档修改输出；接收当前 manifest result 字段 |
| `buildEnd({ output, isRebuild })` | 构建后输出最终产物 |
| `dispose(ctx)` | 清理资源 |

先于这些 hooks 运行的 `config()` 与 `setup()` 合同见
[插件开发](./plugin-authoring)。

## Rebuild 与 Watch 行为

每个 `buildEnd()` hook 都会收到 canonical build result 的一份隔离快照。修改只在当前
hook 内可见，不会改变后续 hook 或 deployment adapter 收到的输入。

在 dev 中，首次 linked output 后会以 `isRebuild: false` 调用 `buildEnd()`，之后每次
重新链接的构建都会以 `isRebuild: true` 调用。

`buildStart()` 并不是每次 rebuild 都与 `buildEnd()` 成对执行的 hook。它会在初始
plugin/config snapshot 的 `setup()` 之后执行，也会在配置更新重新暂存该 snapshot 时
执行；普通 graph rebuild 会复用已安装 hooks，不会再次调用它。

`setup()`、`buildStart()` 和 contribution context 提供 `addWatchFile()` 来注册 analysis
依赖；晚期 output、HTML 与 dispose context 不提供它。文件变化时，框架复用已提交的
config、Application options 与 setup hooks，再重新执行 contributions 和 graph analysis。
需要读取变化数据时，应在 `contributions()` 中读取，不要在 `setup()` 中缓存。

`bundlerConfig()` context 的 `addWatchFile()` 注册实际 bundler config 依赖。文件变化时，
框架会先暂存一份完整的 config 与 plugin 快照，再应用对应的 plan update。如果所选
adapter 无法安全地原地替换配置，更新会 fail-closed 并明确提示重启，不会继续使用混合
或过期状态。

## Build Output 所有权

`buildOutput()` 只能调整已链接的 `AssetGroup` 内容和 `deployment` metadata。
`deployment` 必须是可无损 JSON 序列化的普通对象。函数、访问器、非有限数值、负零、
不安全 key、稀疏数组和循环引用会在引入它们的 hook 执行后立即被拒绝，后续 output
hook 与发布阶段都不会继续执行。

其他 `BuildOutput` 字段仍由 framework 持有，包括：

- build id、输出路径和 public path；
- runtime endpoint 与 transport；
- server entry、renderer、function 与 route；
- Application、Page、RSC 与 PPR 语义。

Hook 不能新增、删除或重排 framework record 或数组。具体来说，hook 不能新增、删除或
重命名 Application、Page、Route 或 Document，不能调整 Route 顺序、修改 Page path
或 Route ownership，也不能修改 Document file name 和 static alias。这些值必须在
graph linking 前完成配置。

## HTML Transform Context

`transformHtml()` 会为每个实际发射的 static HTML 文件，以及每个在构建期编译的
Page-specific request-time document shell，分别接收一个已解析 HTML 文档。应通过
`ctx.owner.kind` 判断当前文档归属，不要从文件名猜。

```ts
transformHtml(doc, ctx) {
  doc.head?.appendChild(doc.createComment(` build ${ctx.buildId} `));

  if (ctx.owner.kind === "application") {
    doc.documentElement?.setAttribute("data-app", ctx.applicationId);
  }

  if (ctx.owner.kind === "page") {
    doc.documentElement?.setAttribute("data-page", ctx.owner.pageId);
  }
}
```

Context 字段包括：

- `ctx.documentId` 与 `ctx.applicationId`；
- `ctx.owner`：`{ kind: "application" }`、
  `{ kind: "page", pageId }` 或 `{ kind: "plugin", pluginId }`；
- `ctx.fileName` 和 `ctx.template`；对于 request-time shell，`fileName` 是逻辑
  Document filename，不会作为 static file 发射；
- `ctx.assets`；
- `ctx.output`，即当前 build output；
- `ctx.buildId` 和 `ctx.publicPath`。

文档类型是 `HtmlDocument`，它是标准 DOM API 的 bundler 无关子集：

```ts
import type { HtmlDocument } from "@evjs/ev/plugin";
```

## 最终 Build Result

`buildEnd()` 接收最终构建输出、framework runtime 与 canonical deployment metadata：

```ts
setup() {
  return {
    buildEnd({
      output,
      frameworkRuntime,
      deploymentMetadata,
      isRebuild,
    }) {
      console.log("Apps:", Object.keys(output.apps));
      console.log("Pages:", Object.keys(output.pages));
      console.log("Runtime routing:", frameworkRuntime?.routing.kind);
      console.log("Server entry:", deploymentMetadata.server.entry);
      console.log("Deploy routes:", deploymentMetadata.routes.length);
      console.log("Rebuild:", isRebuild);
    },
  };
}
```

部署插件应优先从 `deploymentMetadata` 读取 routes、documents、assets 和 server entry。
需要完整内部 build graph 的插件仍可在内存中检查 `output`；需要 runtime 信息的插件可
读取 `frameworkRuntime`。部署规划应直接使用 `deploymentMetadata`，不要再派生拆分的
client/server manifest。HTML hook 会收到同一组结果字段，并额外包含 `ctx.owner`、
`ctx.fileName`、`ctx.assets` 等文档字段。

## Bundler Config

`definePlugin()` 默认创建 bundler 无关的插件，同一个 factory 可安装到
Utoopack 或 webpack 应用。底层 bundler 修改应使用类型安全的 adapter
helper；每个 helper 只会在对应 adapter 下调用回调，并提供该 adapter 的具体
config 类型。

最终 BuildPlan 始终是 framework runtime endpoint 与 output ownership 的事实源。
`bundlerConfig()` hook 可以定制受支持的 loader、resolution、optimization 等底层
setting，但不能覆盖 framework client/server 输出路径。即使关闭 recursive clean，
adapter 也会在 hook 运行后按 BuildPlan 校验这些路径。Plugin 持有的 clean output
同样必须位于 framework 持有的 `distDir` 内，且不能与 client/server output 重叠。

Utoopack 示例：

```ts
import { merge, utoopack } from "@evjs/bundler-utoopack";
import { definePlugin } from "@evjs/ev/plugin";

export const yamlPlugin = definePlugin({
  id: "@example/yaml-support",
  setup() {
    return {
      bundlerConfig: utoopack((cfg) => {
        merge(cfg, {
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

切换到 webpack 的项目，选择 webpack adapter 并使用它的类型安全 helper
即可。`defineConfig()` 会从 adapter 自动推断 bundler config 类型：

```ts
import { defineConfig } from "@evjs/ev";
import { webpack, webpackAdapter } from "@evjs/bundler-webpack";
import { definePlugin } from "@evjs/ev/plugin";

const webpackAlias = definePlugin({
  id: "@example/webpack-alias",
  setup() {
    return {
      bundlerConfig: webpack((config) => {
        config.resolve ??= {};
        config.resolve.alias ??= {};
        config.resolve.alias["@app"] = "./src";
      }),
    };
  },
});

export default defineConfig({
  bundler: webpackAdapter,
  plugins: [webpackAlias()],
});
```

完整示例见[插件配方](./plugin-recipes)。
