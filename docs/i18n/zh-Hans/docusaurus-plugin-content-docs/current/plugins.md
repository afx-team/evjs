# 使用插件

插件可以增加集成、构建或部署行为，而不必扩张 evjs 核心配置。先为应用安装一次插件，再在集成支持页面作用域时配置单个页面。

## 安装插件

导入 Factory 并在 `ev.config.ts` 中调用：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/analytics";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    analytics({
      endpoint: "/events",
      debug: false,
    }),
  ],
});
```

Factory 调用同时完成安装并提供应用级选项。没有选项的插件仍需调用，例如 `buildTimer()`。

插件执行顺序就是数组顺序。两个插件影响同一产物时，请按各集成推荐顺序安装。

## 配置单个页面

支持页面配置的插件会在相邻 `page.config.ts` 中暴露 id：

```ts title="src/pages/checkout/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  plugins: {
    analytics: {
      channel: "checkout",
    },
  },
});
```

不要在页面配置中导入插件包。使用 `ev.config.ts` 时，生成的 TypeScript 声明会为已安装插件 id 与页面值提供补全。保持忽略 `src/plugin-types.d.ts`，由框架更新。

## 理解两种作用域

应用与页面选项有意保持独立：

| 作用域 | 位置 | 适合内容 |
| --- | --- | --- |
| 应用 | `ev.config.ts` 中的插件 Factory | 端点、凭据引用、构建选择、插件允许的回调 |
| 页面 | `page.config.ts#plugins` 中的插件 id | 单个页面拥有的静态元信息或行为 |

页面选项必须是静态 JSON 数据，不继承应用字段，应用字段也不会复制进页面值。不要把秘密放进页面值，或放进插件标记为浏览器可见的任何选项。

## 选择默认或显式启用行为

插件声明的页面默认值决定“省略”意味着什么：

| 写法 | 行为 |
| --- | --- |
| `analytics(options)` | 安装插件。存在页面默认值时，省略的页面使用默认值；否则该页面关闭。 |
| `analytics.forPages(options)` | 安装插件，但即使存在默认值，每个页面也必须显式启用。 |
| 页面值 `false` | 为当前页面关闭插件。 |
| 页面值 `true` | 使用声明的页面默认值启用；插件没有默认值时非法。 |
| 页面值 `{ ... }` | 使用提供的类型化页面选项启用，并覆盖页面默认值。 |

仅在选定页面启用时使用 `forPages()`：

```ts title="ev.config.ts"
export default defineConfig({
  plugins: [analytics.forPages({ endpoint: "/events" })],
});
```

```ts title="src/pages/checkout/page.config.ts"
export default definePageConfig({
  plugins: {
    analytics: true,
  },
});
```

插件没有页面默认值时，请提供必需对象而不是 `true`。

## 条件关闭整个插件

应用插件数组接受 `false`、`null` 与 `undefined`：

```ts
export default defineConfig({
  plugins: [process.env.ANALYTICS === "1" && analytics(options)],
});
```

这种方式适合没有页面配置的集成。条件插件并不保证存在，因此其 id 无法安全提供给 `page.config.ts`。支持页面配置的插件应确定性安装，并使用 `forPages()` 或页面值 `false`。

## 保持页面类型可靠

需要页面补全时，让支持页面配置的 Factory 直接留在 `defineConfig()` 的元组中：

```ts
export default defineConfig({
  plugins: [analytics(options), accessControl(options)],
});
```

避免把列表扩宽成通用插件数组，也不要在整组数组间做条件选择。TypeScript 只能暴露静态确定会安装的插件。

## 诊断插件配置

运行：

```bash
ev inspect
```

它会报告已安装插件、页面配置与校验错误。常见问题包括：

- 页面使用了未安装的插件 id；
- 插件没有页面默认值却设置 `true`；
- 页面配置包含函数、Symbol、类实例、循环引用或非有限数值；
- 条件安装了页面仍尝试配置的插件；
- 期望应用字段合并到页面值。

## 开发插件

应用作者通常读到这里即可。创建集成时继续阅读：

| 目标 | 阅读 |
| --- | --- |
| 定义类型化应用与页面选项 | [插件开发](./plugin-authoring) |
| 选择生命周期 Hook | [插件 Hooks](./plugin-hooks) |
| 生成模块或挂载框架代码 | [生成代码](./generated-contributions) |
| 从小型示例开始 | [插件配方](./plugin-recipes) |
| 配置官方微前端桥接 | [Qiankun](./qiankun) |
