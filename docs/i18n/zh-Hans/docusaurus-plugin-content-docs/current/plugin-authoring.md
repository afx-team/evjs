# 插件开发

使用 `@evjs/ev/plugin` 导出的 `definePlugin()` 声明稳定的插件标识、类型安全的配置合同，
以及插件扩展的框架阶段。应用通过 `config.plugins` 使用返回的工厂。

插件开发模型只有三层：`pluginOptions()` 声明插件持有的 Application 或 Page 数据；
`configure()`、`emitIR()` / `emitPageIR()` 等 descriptor 方法参与框架规划；
`setup()` 返回命令式 lifecycle hooks。同一项行为只应属于其中一层。
这三层描述的是职责，并非三个相邻的时间段：`configure()` 早于 `setup()` 执行，而
IR emission 会在之后的 graph planning 中执行。`emitIR()` 与 `emitPageIR()` 只声明
由 evjs 收集、校验并物化的确定性 record，不会立即写文件。Descriptor 方法不能出现在
`setup()` 返回值中，lifecycle hook 也不能直接写在 descriptor 上。

## 定义最小插件

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const outputReporter = definePlugin({
  name: "@example/output-reporter",
  setup() {
    let start = 0;
    return {
      beforeBuild() {
        start = Date.now();
      },
      afterBuild({ output }) {
        console.log(
          `Canonical output ${output.buildId} published in ${Date.now() - start}ms`,
        );
      },
    };
  },
});
```

这段耗时只覆盖 fresh bundler facts 就绪后的 canonical output 链接与发布，
不包含 bundler 编译。

`definePlugin()` 返回工厂，而不是已经安装的插件。应用在 `ev.config.ts` 中调用它：

```ts
import { defineConfig } from "@evjs/ev";
import { outputReporter } from "@example/output-reporter";

export default defineConfig({
  plugins: [outputReporter()],
});
```

对于其他条件相同的插件，`plugins` 数组保留安装顺序；required dependency 与当前存在的
optional dependency 会进行稳定拓扑排序。框架不再把一个全局 pre/post 层级投影到彼此
无关的插件阶段。工厂参数承载 Application 配置，不再维护并行的顶层配置 bag。

## 声明 Application 与 Page 合同

一个 descriptor 可以声明两份独立合同：

```ts
import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

type AnalyticsApplicationConfig = {
  endpoint: string;
  debug?: boolean;
};

type AnalyticsPageConfig = {
  channel: string;
};

export const analytics = definePlugin({
  name: "@company/analytics",
  key: "analytics",

  application: pluginOptions<AnalyticsApplicationConfig>({
    validate(value) {
      return value.endpoint.startsWith("/") || "endpoint must start with /";
    },
  }),

  page: pluginOptions<AnalyticsPageConfig>({
    defaults: { channel: "web" },
    validate(value) {
      return value.channel.length > 0 || "channel must not be empty";
    },
  }),

  setup(ctx) {
    // Application setting 会在 setup() 前解析。
    console.log(ctx.options.endpoint);
  },

  emitIR(ctx) {
    // ctx.pages 只包含已启用的 Page。
    for (const { page, options } of ctx.pages) {
      console.log(page.id, options.channel);
    }
  },
});
```

Application 工厂参数从 `application` 推导。生成的 `src/plugin-types.d.ts` 声明会桥接
静态 `typeof import("../ev.config").default` 类型，TypeScript 再从中推导每个 plugin
`key` 及其供 `definePageConfig()` 使用的 Page value。精确桥接适用于 `ev.config.ts`；
JavaScript 配置保持安全，但不会声称拥有精确 plugin key。可能进入 falsy 分支的条目也会
被排除，因为运行时并不保证安装它们。宽化后的 array，以及条件化的 config 或 array
联合也会基于同一理由被排除；需要 Page 配置的插件应直接放在传给 `defineConfig()` 的
tuple 中。
Application 与 Page 的具体写法见[插件](./plugins)。

`ev prepare`、`ev dev` 与 `ev build` 会在 Page graph analysis 前把该声明生成到
`src` 下。即使后续 Page 校验失败，编辑器补全也仍然可用。它有意不放在普通应用
TypeScript 配置通常会排除的 `.ev` 中。

Application 与 Page value 不会相互合并。在任一合同内部，authoring 字段会在校验前
深度合并到该合同的 defaults。`setup()` 只接收
`ctx.options`；`emitIR()` 还会接收所有已启用的
`ctx.pages`，其中每一项直接暴露 `{ page, options }`。逐个处理已启用 Page 时使用
`emitPageIR()`；它直接暴露 `ctx.options`、`ctx.page` 与 `ctx.pageOptions`。

## 合同、默认值与校验

`pluginOptions<T>()` 声明必须提供 object 的合同。使用
`pluginOptions<T>({ defaults, validate?, schemaVersion? })` 后，合同支持默认值。

defaults 可以是 object，也可以是接收 Application/Page setting context 的同步函数。
authoring 字段会深度合并到 defaults，包括嵌套的 plain object；显式 `undefined` 按省略
处理。array 与非 plain object 是原子值，只能整体替换。`validate` 可以返回
`true`/`void`、返回 `false` 或错误消息，也可以抛错。

每次 config pipeline 开始时，evjs 会准确解析一次所有已安装插件的 Application 合同。
`configure()`、`setup()` 与 IR emission 方法共用同一份快照。因此，context 派生的
`routingMode` 表示 `configure()` 运行前的 authored mode；如果需要最终解析后的框架
mode，应读取后续方法的 `ctx.config`。

Page 省略语义由 Page 合同是否有 defaults，以及 defaultable 合同采用的工厂写法共同
决定。使用 `plugin(options)` 时，有 defaults 的 Page 在省略 key 后使用 defaults，
否则关闭。defaultable 合同还会暴露 `plugin.withPageOptIn(options)`，此时省略始终关闭；
non-defaultable 合同本身已经是 opt-in-only，不再暴露多余的方法。显式 `false` 关闭
Page，`true` 要求 defaults，object 则在合并 defaults 并校验后启用 Page。

Standard Schema 库可以直接推导 input 与 output 类型：

```ts
application: pluginOptions(applicationSchema),
page: pluginOptions(pageSchema, {
  defaults: { channel: "web" },
}),
```

Standard Schema 校验必须在配置或 graph analysis 阶段同步完成。

Application 合同可以在插件支持时包含只在构建期使用的 callback 或 module reference。
Page 合同更严格：配置值与解析结果必须是普通、JSON 可序列化的 object。function、
symbol、bigint、非有限数值、class instance、稀疏数组与循环引用都会被拒绝。

插件必须显式投影 runtime data，且不能暴露 Application secret。Page 配置需要选择
可执行 runtime code 时，优先使用显式 module reference。

## 标识与顺序

插件 `name` 是稳定的依赖与生命周期标识。只要声明 Application 或 Page options，
就必须提供短小写 `key`，例如 `analytics` 或 `error-reporting`。同一个 key 同时
标识两份合同及其 CoreGraph setting；纯 hooks 插件可以省略。一个 Application 中的
plugin name 与 plugin key 都必须分别唯一。

`dependencies` 指定必须先安装且保持 active 的插件。`optionalDependencies` 只在目标
插件存在且 active 时增加同样的顺序边；其他情况保留 authored array 顺序。未知
descriptor 字段与拼错的 hook 会被拒绝。

插件配置只存在于 Application 与 Page scope。在 graph analysis 阶段根据已启用 Page
派生 Route/Document 效果，再通过 [generated contributions](./generated-contributions)
输出。

## 提前修改框架配置

`configure()` 用于修改必须早于框架默认值解析、路由发现、dev proxy 或 runtime path
派生的框架配置。它可以返回 config object，也可以在原对象上就地修改后返回
`undefined`。收到的是与调用方及上一份已提交 dev 配置隔离的工作副本，因此失败的
reload 不会泄漏候选 mutation。
`null`、array 和其他返回值会被拒绝。最终配置会经过和用户配置相同的 resolver 校验，
然后才会运行 `setup()` 或开始 bundling。
`configure()` 可以修改框架字段，但不能新增、删除、替换或重排 `config.plugins`。
完整插件列表必须在 `defineConfig()` 中声明，这样依赖排序、类型安全 options 与
rollback 才会始终引用同一份稳定快照。

```ts
import { defineConfig } from "@evjs/ev";
import { merge } from "@evjs/ev/config";
import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

const serverBasePath = definePlugin({
  name: "@example/server-base-path",
  key: "server-base-path",
  application: pluginOptions({
    defaults: { basePath: "/_framework" },
  }),
  configure(config, ctx) {
    merge(config, {
      server: {
        basePath: ctx.options.basePath,
      },
    });
    return config;
  },
});

export default defineConfig({
  plugins: [serverBasePath({ basePath: "/_internal" })],
});
```

不要用 `configureBundler()` 修改框架协议路径。Server function、PPR 和 RSC endpoint
都从 `server.basePath` 派生。

`configure()` 完成后，后续阶段的 `ctx.config` 是 resolved framework config 的隔离、
冻结 metadata 视图。已安装插件只暴露 identity、key 与 activation state；选中的 bundler
只暴露 name 与 capabilities。其他插件的 callable hooks 和 adapter build/dev 方法不会
通过 context 泄露。`configureBundler()` 只能修改其显式传入的 bundler config 参数。
插件作者应把 framework 配置变更都放在这个经过校验的阶段。

## 在 `setup()` 中初始化共享状态

使用 `setup()` 初始化共享状态并返回生命周期 hooks。返回值必须是 hooks object 或
`undefined`；`null`、array 和非函数 hook 字段会在生命周期 hooks 运行前被拒绝。
未知 hook key 也会被拒绝，避免拼写错误静默 no-op。插件包自己的 metadata 应放在
hooks object 之外。

Setup context 提供 `mode`、`command`、`cwd`、resolved `config`、`logger`、
`addWatchFile()`、`onDispose()`，以及 descriptor 声明的类型安全 Application
`ctx.options`。资源分配成功后应立即通过 `ctx.onDispose()` 注册清理：

```ts
setup(ctx) {
  const watcher = createWatcher();
  ctx.onDispose(() => watcher.close());

  return {
    beforeBuild() {
      watcher.refresh();
    },
  };
}
```

注册的 callback 会在插件快照 dispose 时按注册逆序执行；即使 `setup()` 抛错或返回
无效 hooks object，也会执行，因此不会遗留只完成部分初始化的资源。正常快照 teardown
时，返回的 `dispose()` hook 先于这些 callback 执行。Callback 必须在 `setup()`
settle 前完成注册。

`configure()`、`setup()`、IR emission 与返回的 lifecycle hook 失败时，diagnostic
都会同时标识插件 `name` 和失败 hook。导出的 `PluginHookError` 还提供稳定的
`code`、`plugin`、`hook` 与 `cause` 字段，供程序化处理。

生命周期顺序与各 hook 合同见[插件 Hooks](./plugin-hooks)。

## 安装与执行模式

普通工厂与 `withPageOptIn()` 控制 Page 省略语义，不改变类型安全的 Application
options；`.when()` 单独控制已安装插件本次是否执行：

- `plugin(options)` 安装并执行插件；Page 有 defaults 时，省略 key 会启用该 Page；
- Page 合同有 defaults 时，`plugin.withPageOptIn(options)` 使用相同 Application options
  安装并执行同一个插件，但每个 Page 都必须通过 `true` 或 object 显式启用；
- `plugin(options).when(condition, reason?)` 保持合同与生成的 Page 类型已安装；条件为
  false 时关闭 owner settings，并跳过 `configure()`、`setup()` 与 IR emission；
- `config.plugins` 中的 `false`、`null` 或 `undefined` 会省略整个插件，不执行任何插件
  hook。

无论使用哪种可用工厂写法，必填 Application 参数都保持必填。
可复用的类型安全组合应使用 `definePluginPreset(factory)`；裸嵌套数组和异步 preset
结果会被拒绝。

## 选择合适的扩展点

| 需求 | API |
|---|---|
| 在 discovery 前修改框架配置 | `configure()` |
| 初始化共享状态 | `setup()` |
| 从 fresh bundler facts 开始一次 framework output/link 周期 | `beforeBuild()` |
| 执行 build lifecycle 行为 | `setup()` 返回的 hooks |
| 生成模块或挂载结构化行为 | `emitIR()` 或 `emitPageIR()` |
| 编译自定义文件类型或调整优化 | `configureBundler()` |
| 改写已解析的 HTML 文档 | `transformHtml()` |
| 在 projection 前调整 linked assets 或 deployment metadata | `transformOutput()` |
| 输出稳定后写入最终外部产物 | `afterBuild()` |

`emitIR()` 与 `emitPageIR()` 应保持确定性且不产生外部副作用。它们声明 IR record，
不会直接写入 `.ev`；当发射的源码 alias 改变 framework graph 时，evjs 可能会再次
执行它们。
