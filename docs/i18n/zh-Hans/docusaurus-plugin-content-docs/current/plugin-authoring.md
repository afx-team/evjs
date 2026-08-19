# 插件开发

使用 `@evjs/ev/plugin` 导出的 `definePlugin()` 声明稳定的插件标识、类型安全的配置契约，
以及插件参与的框架阶段。应用通过 `config.plugins` 调用返回的工厂函数。

插件 API 分为三部分：`pluginOptions()` 声明应用级或页面级配置；插件描述对象的方法
声明配置、生成代码与开发命令行行为；`setup()` 返回需要执行副作用的生命周期钩子。
同一项行为只应放在其中一处。`configure()` 最先执行；evjs 随后解析 `emitIR()` 和
`emitPageIR()` 声明；只有这些声明成功完成后才执行 `setup()`。插件描述对象的方法不能
出现在 `setup()` 返回值中，生命周期钩子也不能直接写在描述对象上。

`cliShortcuts()` 独立于 `setup()` 状态声明终端按键与操作。开发环境重启时会重新运行
插件 `setup()` 并收集快捷键；普通构建器 HMR 不会重复执行。快捷键操作可以读取当前
客户端来源，并关闭整个开发进程。描述对象和操作契约见
[插件 CLI 快捷键](./dev#交互式快捷键)。

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

其他条件相同时，`plugins` 数组保留安装顺序；声明的依赖关系与 `enforce` 层级可以调整
钩子顺序。工厂函数参数承载应用级配置，不需要再维护一份并行的顶层配置对象。

## 声明应用级与页面级配置契约

一个插件描述对象可以声明两份独立契约：

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
    // 应用级选项会在 setup() 前解析。
    console.log(ctx.options.endpoint);
  },

  emitIR(ctx) {
    // ctx.pages 只包含已启用的页面。
    for (const { page, options } of ctx.pages) {
      console.log(page.id, options.channel);
    }
  },
});
```

插件工厂的参数类型由 `application` 契约推导。生成的 `src/plugin-types.d.ts` 会引用
`typeof import("../ev.config").default`，TypeScript 据此推导每个插件 `id` 及其供
`definePageConfig()` 使用的页面配置类型。TypeScript 编写的 `ev.config.ts` 可以获得精确
类型；JavaScript 配置仍会安全运行，但无法生成精确的页面插件 id 列表。条件项、已扩宽
类型的数组，以及配置或数组的联合类型都无法保证插件一定安装，因此不会进入这份精确
类型。需要页面配置类型的插件应直接写在传给 `defineConfig()` 的元组中。
应用级与页面级配置写法见[使用插件](./plugins)。

应用级与页面级配置不会相互合并。在任一契约内部，用户填写的字段会在校验前深度合并到
该契约的默认值。`setup()` 只接收
`ctx.options`；`emitIR()` 还会接收所有已启用的
`ctx.pages`，其中每一项直接提供 `{ page, options }`。逐个处理已启用页面时使用
`emitPageIR()`；它直接暴露 `ctx.options`、`ctx.page` 与 `ctx.pageOptions`。

## 配置契约、默认值与校验

`pluginOptions<T>()` 声明值必须为对象的配置契约。使用
`pluginOptions<T>({ defaults, validate?, schemaVersion? })` 后，该契约支持默认值。

`defaults` 可以是对象，也可以是接收应用或页面配置上下文的同步函数。用户配置会深度
合并到默认值中，包括嵌套的普通对象；显式 `undefined` 按省略处理。数组与非普通对象
只能整体替换。`validate` 可以返回
`true`/`void`、返回 `false` 或错误消息，也可以抛错。

每次配置流程开始时，evjs 会解析一次所有已安装插件的应用级契约。
`configure()`、`setup()` 与生成代码的方法共用同一份解析结果。因此，上下文中的
`routingMode` 表示 `configure()` 运行前用户声明的模式；如果需要最终解析后的框架
模式，应读取后续方法中的 `ctx.config`。

页面省略插件配置时的行为，由页面契约是否提供默认值以及所用工厂函数共同决定。使用
`plugin(options)` 时，有默认值的页面会使用默认值，否则关闭。提供默认值的契约还会
暴露 `plugin.forPages(options)`，此时省略始终表示关闭；没有默认值的契约本身就是按页
启用，不再暴露额外方法。显式 `false` 关闭页面插件，`true` 要求契约提供默认值，对象值
则在合并默认值并校验后启用。

Standard Schema 库可以直接推导输入与输出类型：

```ts
application: pluginOptions(applicationSchema),
page: pluginOptions(pageSchema, {
  defaults: { channel: "web" },
}),
```

Standard Schema 校验必须在配置解析或语义图分析阶段同步完成。

应用级契约可以在插件支持时包含仅在构建时使用的回调或模块引用。页面级契约更严格：
配置值与解析结果必须是普通、可序列化为 JSON 的对象。函数、Symbol、BigInt、非有限
数值、类实例、稀疏数组与循环引用都会被拒绝。

插件必须显式生成运行时需要的数据，且不能暴露应用密钥。页面配置需要选择可执行的
运行时代码时，优先使用明确的模块引用。

## 标识与顺序

每个插件只声明一个稳定、短小的 `id`，使用小驼峰或全小写短横线形式，例如
`analytics`、`errorReporting` 或 `error-reporting`。
同一个插件 id 用于依赖关系、生命周期状态和生成代码；插件声明页面契约时，
它也作为 `page.config.ts#plugins` 中的键。它不是包名，也没有独立的页面别名：包可以叫
`@company/analytics`，插件 id 则是 `analytics`。id 必须以小写字母开头，后续可以使用
不带分隔符的 ASCII 字母和数字，也可以使用由连字符分隔的非空全小写字母数字段；同一个
id 不能混用驼峰与短横线形式。
`__proto__`、`constructor`、`prototype`，以及 Windows 设备基本名称（`con`、
`prn`、`aux`、`nul`、`com1` 至 `com9`、`lpt1` 至 `lpt9`）是保留值。这保证原样
使用的 id 在所有支持平台上都能安全地作为生成路径中的单个路径段。一个应用中的插件
id 在忽略大小写后必须唯一，因此 `errorReporting` 与
`errorreporting` 不能同时安装。

`dependencies`、`optionalDependencies` 与 `enforce` 控制钩子顺序。未知的插件描述
字段与拼错的钩子会被拒绝。

插件配置只分为应用级和页面级。框架在语义图分析阶段根据已启用页面计算路由和文档
效果，再通过[生成代码](./generated-contributions)输出。

## 提前修改框架配置

`configure()` 用于修改必须早于框架默认值解析、路由发现、开发代理或运行时路径计算的
框架配置。它可以返回配置对象，也可以就地修改收到的对象后返回 `undefined`。该对象是
与调用方及上一份已生效开发配置隔离的工作副本，因此重载失败不会泄漏尚未生效的修改。
工作副本会刻意排除 `config.plugins`。插件安装由应用配置决定，其条目和声明顺序会在
完整生命周期内保持不变；钩子的实际执行顺序仍由 `dependencies`、
`optionalDependencies` 与 `enforce` 决定。无论原地添加还是随返回值提供，任何自有
`plugins` 属性（包括 `undefined`）都会被拒绝。所有已解析的插件上下文都会看到同一份
隔离且冻结的框架配置，因此初始化、生成代码、构建器和生命周期钩子都无法通过
`ctx.config` 修改应用的实时配置。
`null`、数组和其他返回值会被拒绝。最终配置会经过与用户配置相同的解析校验，然后才会
运行 `setup()` 或开始打包。

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

不要用 `configureBundler()` 修改框架协议路径。服务端函数、PPR 和 RSC 端点
都从 `server.basePath` 派生。

`configure()` 完成后，后续阶段的 `ctx.config` 在类型上都是最终框架配置的深度只读
视图。`configureBundler()` 只能修改显式传入的构建器配置。插件作者应把框架配置变更
都放在这个经过校验的阶段。

## 在 `setup()` 中初始化共享状态

使用 `setup()` 初始化共享状态并返回生命周期钩子。返回值必须是钩子对象或
`undefined`；`null`、数组和非函数钩子字段会在生命周期运行前被拒绝。未知钩子名也会
被拒绝，避免拼写错误被静默忽略。插件包自身的元数据应放在钩子对象之外。

初始化上下文提供 `mode`、`cwd`、最终 `config`、`logger`、`addWatchFile()`，以及插件
描述对象声明的类型安全应用选项 `ctx.options`。插件通过
`mode` 区分开发与生产环境。生命周期顺序与各钩子契约见[插件生命周期钩子](./plugin-hooks)。

公开的上下文类型名称与阶段一一对应：`PluginConfigureContext`、
`PluginSetupContext`、`PluginEmitIRContext`、`ConfigureBundlerContext`、
`DevServerReadyContext`、`BeforeBuildContext`、`TransformOutputContext`、
`TransformHtmlContext` 与 `DisposeContext`。生成代码通过 `ctx.framework` 读取标准化的
`FrameworkView`。插件选项辅助 API 公开 `PluginOptionsContract`、
`PluginOptionsDefinition` 与 `PluginOptionsContext`；内部工厂推导类型不属于公开的
插件开发 API。

## 配置插件与页面启用方式

工厂函数只控制页面省略插件配置时的行为，不改变插件执行和类型安全的应用级选项：

- `plugin(options)` 安装并执行插件；页面契约有默认值时，页面省略该插件项仍会启用插件；
- 页面契约有默认值时，`plugin.forPages(options)` 使用相同应用级选项安装并执行插件，
  但每个页面都必须通过 `true` 或对象显式启用；
- `config.plugins` 中的 `false`、`null` 或 `undefined` 会省略整个插件，不执行任何插件
  钩子。

无论使用哪种工厂写法，必填的应用级参数都保持必填。

## 选择合适的扩展点

| 需求 | API |
|---|---|
| 在文件发现前修改框架配置 | `configure()` |
| 声明交互式开发命令行快捷键 | `cliShortcuts()` |
| 初始化共享状态 | `setup()` |
| 执行构建生命周期行为 | `setup()` 返回的钩子 |
| 在 fallback 前拦截客户端开发请求 | `clientDevMiddleware()` |
| 开发服务器监听后获取实际客户端来源 | `devServerReady()` |
| 生成模块或挂载结构化行为 | `emitIR()` 或 `emitPageIR()` |
| 编译自定义文件类型或调整优化 | `configureBundler()` |
| 改写已解析的 HTML 文档 | `transformHtml()` |
| 写入前调整关联资源或部署元数据 | `transformOutput()` |
| 输出稳定后写入最终外部产物 | `afterBuild()` |

`emitIR()` 应保持确定性且不产生外部副作用。当插件提供的源码别名改变框架语义图时，
evjs 可能会再次执行它。
