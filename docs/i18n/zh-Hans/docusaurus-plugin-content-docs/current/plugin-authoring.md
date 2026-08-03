# 插件开发

使用 `@evjs/ev/plugin` 导出的 `definePlugin()` 声明稳定的插件标识、类型安全的配置合同，
以及插件扩展的框架阶段。应用通过 `config.plugins` 使用返回的工厂。

插件开发模型只有三层：`pluginOptions()` 声明插件持有的 Application 或 Page 数据；
`configure()`、`emitIR()` 等 descriptor 方法参与框架规划；`setup()` 返回命令式
lifecycle hooks。同一项行为只应属于其中一层。
这三层描述的是职责，并非三个相邻的时间段：`configure()` 早于 `setup()` 执行，而
`emitIR()` 会在之后的 graph planning 中执行。Descriptor 方法不能出现在
`setup()` 返回值中，lifecycle hook 也不能直接写在 descriptor 上。

## 定义最小插件

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const buildTimer = definePlugin({
  id: "build-timer",
  setup() {
    const start = Date.now();
    return {
      afterBuild({ output }) {
        console.log(`Build ${output.buildId} finished in ${Date.now() - start}ms`);
      },
    };
  },
});
```

`definePlugin()` 返回工厂，而不是已经安装的插件。应用在 `ev.config.ts` 中调用它：

```ts
import { defineConfig } from "@evjs/ev";
import { buildTimer } from "@example/build-timer";

export default defineConfig({
  plugins: [buildTimer()],
});
```

对于其他条件相同的插件，`plugins` 数组保留安装顺序；声明的 dependencies 与
`enforce` 层级可以重排 hooks。工厂参数承载 Application 配置，不再维护并行的顶层
配置 bag。

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
  id: "analytics",

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
`id` 及其供 `definePageConfig()` 使用的 Page value。精确桥接适用于 `ev.config.ts`；
JavaScript 配置保持安全，但不会声称拥有精确的 Page plugin-id registry。可能进入
falsy 分支的条目也会被排除，因为运行时并不保证安装它们。宽化后的 array，以及条件化
的 config 或 array 联合也会基于同一理由被排除；需要 Page 配置的插件应直接放在传给
`defineConfig()` 的 tuple 中。
Application 与 Page 的具体写法见[插件](./plugins)。

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
`configure()`、`setup()` 与 contribution 方法共用同一份快照。因此，context 派生的
`routingMode` 表示 `configure()` 运行前的 authored mode；如果需要最终解析后的框架
mode，应读取后续方法的 `ctx.config`。

Page 省略语义由 Page 合同是否有 defaults，以及 defaultable 合同采用的工厂写法共同
决定。使用 `plugin(options)` 时，有 defaults 的 Page 省略该插件 id 后使用 defaults，
否则关闭。defaultable 合同还会暴露 `plugin.forPages(options)`，此时省略始终关闭；
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

每个插件只声明一个稳定、短小写的 `id`，例如 `analytics` 或 `error-reporting`。
同一个 canonical id 用于依赖与生命周期状态、generated IR；插件声明 Page 合同时，
它也作为 `page.config.ts#plugins` 中的键。它不是 package name，也没有独立的 Page
别名：package 可以叫 `@company/analytics`，plugin id 则是 `analytics`。id 必须以
小写字母开头，只能包含小写字母、数字，以及用单个连字符分隔的 segment；
`__proto__`、`constructor`、`prototype`，以及 Windows 设备 basename（`con`、
`prn`、`aux`、`nul`、`com1` 至 `com9`、`lpt1` 至 `lpt9`）是保留值。这保证原样
使用的 id 在所有支持平台上都能安全地作为 generated path 的单个 segment。一个
Application 中的 plugin id 必须唯一。

`dependencies`、`optionalDependencies` 与 `enforce` 控制 hook 顺序。未知 descriptor
字段与拼错的 hook 会被拒绝。

插件配置只存在于 Application 与 Page scope。在 graph analysis 阶段根据已启用 Page
派生 Route/Document 效果，再通过 [generated contributions](./generated-contributions)
输出。

## 提前修改框架配置

`configure()` 用于修改必须早于框架默认值解析、路由发现、dev proxy 或 runtime path
派生的框架配置。它可以返回 config object，也可以在原对象上就地修改后返回
`undefined`。收到的是与调用方及上一份已提交 dev 配置隔离的工作副本，因此失败的
reload 不会泄漏候选 mutation。
工作副本会刻意排除 `config.plugins`。插件安装由 Application 配置持有，其条目和声明
顺序会在完整生命周期快照内保持不变；hook 的实际执行顺序仍由 `dependencies`、
`optionalDependencies` 与 `enforce` 决定。无论原地添加还是随返回值提供，任何自有
`plugins` 属性（包括 `undefined`）都会被拒绝。所有已解析的插件 context 都会看到
同一份隔离、冻结的框架配置视图，因此 setup、contribution、bundler 与 lifecycle hook
无法通过 `ctx.config` 修改 Application 的实时配置。
`null`、array 和其他返回值会被拒绝。最终配置会经过和用户配置相同的 resolver 校验，
然后才会运行 `setup()` 或开始 bundling。

```ts
import { defineConfig } from "@evjs/ev";
import { merge } from "@evjs/ev/config";
import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

const serverBasePath = definePlugin({
  id: "server-base-path",
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

`configure()` 完成后，后续阶段的 `ctx.config` 在类型上都是 resolved framework config 的
深度只读视图。`configureBundler()` 只能修改其显式传入的 bundler config 参数。插件作者应
把 framework 配置变更都放在这个经过校验的阶段。

## 在 `setup()` 中初始化共享状态

使用 `setup()` 初始化共享状态并返回生命周期 hooks。返回值必须是 hooks object 或
`undefined`；`null`、array 和非函数 hook 字段会在生命周期 hooks 运行前被拒绝。
未知 hook key 也会被拒绝，避免拼写错误静默 no-op。插件包自己的 metadata 应放在
hooks object 之外。

Setup context 提供 `mode`、`cwd`、resolved `config`、`logger`、
`addWatchFile()`，以及 descriptor 声明的类型安全 Application `ctx.options`。插件通过
`mode` 区分开发与生产环境。生命周期顺序与各 hook 合同见[插件 Hooks](./plugin-hooks)。

公开 context 名称与阶段一一对应：`PluginConfigureContext`、
`PluginSetupContext`、`PluginEmitIRContext`、`ConfigureBundlerContext`、
`BeforeBuildContext`、`TransformOutputContext`、`TransformHtmlContext` 与
`DisposeContext`。contribution 通过 `ctx.framework` 读取规范化的 `FrameworkView`。
插件 options helper 公开 `PluginOptionsContract`、`PluginOptionsDefinition` 与
`PluginOptionsContext`；内部 factory 推导类型不属于公开 authoring API。

## 安装与执行模式

工厂只控制 Page 省略语义，不改变插件执行和类型安全的 Application options：

- `plugin(options)` 安装并执行插件；Page 有 defaults 时，省略该插件项会启用该 Page；
- Page 合同有 defaults 时，`plugin.forPages(options)` 使用相同 Application options
  安装并执行同一个插件，但每个 Page 都必须通过 `true` 或 object 显式启用；
- `config.plugins` 中的 `false`、`null` 或 `undefined` 会省略整个插件，不执行任何插件
  hook。

无论使用哪种可用工厂写法，必填 Application 参数都保持必填。

## 选择合适的扩展点

| 需求 | API |
|---|---|
| 在 discovery 前修改框架配置 | `configure()` |
| 初始化共享状态 | `setup()` |
| 执行 build lifecycle 行为 | `setup()` 返回的 hooks |
| 生成模块或挂载结构化行为 | `emitIR()` 或 `emitPageIR()` |
| 编译自定义文件类型或调整优化 | `configureBundler()` |
| 改写已解析的 HTML 文档 | `transformHtml()` |
| 在 projection 前调整 linked assets 或 deployment metadata | `transformOutput()` |
| 输出稳定后写入最终外部产物 | `afterBuild()` |

`emitIR()` 应保持确定性且不产生外部副作用。当贡献的源码 alias 改变 framework
graph 时，evjs 可能会再次执行它。
