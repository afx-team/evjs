# 插件

插件通过受支持的生命周期扩展框架，而无需扩大核心应用配置。应用在
`ev.config.ts` 中安装一次插件；Page 再通过插件的短 key 配置、启用或禁用页面级
行为。Lifecycle hook 与声明式 IR emission 继续负责 build、bundler、HTML 和 runtime
集成。

## 安装并配置 Application

导入插件工厂，并在 `plugins` 中调用：

```ts
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/analytics";

export default defineConfig({
  plugins: [analytics({ endpoint: "/events" })],
});
```

工厂调用会安装插件，并提供类型安全的 Application 配置。没有 Application 配置的
插件不接收参数，例如 `outputReporter()`。

`plugins` 数组是有序安装边界。配置直接放在各工厂调用中，因此不需要另一份 extension
bag，也不需要重复 package key。

## 配置 Page

把页面行为放在 Page 旁边，并使用插件的短 key：

```ts
// src/pages/checkout/page.config.ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  plugins: {
    analytics: { channel: "checkout" },
  },
});
```

`page.config.ts` 不需要导入插件。`ev prepare`、`ev dev` 与 `ev build` 会生成
`src/plugin-types.d.ts`，稳定桥接实际发现的配置。使用 `ev.config.ts` 时，TypeScript
会从静态 config 类型推导精确的 plugin key 与 Page value；JavaScript 配置只生成不会
扩散 `any` 的安全桥接，因此 Page 需要插件补全时应使用 TypeScript 配置。只有静态上
保证安装的条目才会暴露给 Page config。不要编辑或导入这份生成声明，并确保项目
`tsconfig.json` 包含 `src`。上述三个生成命令会在 Page graph analysis 前生成该声明。
它有意放在 `src` 而非 `.ev`，因为普通应用 tsconfig 会排除 `.ev`。

Page 保留一层 `plugins` map，避免第三方 key 与 `title`、`render` 等 core 字段冲突。
进入该 map 后只使用短 key，不需要 package name 或另一层 plugin 嵌套。

## Application 与 Page Setting 相互独立

Application 配置与 Page 配置是两份独立的类型合同：

- 只要存在任一合同，插件就声明一个短 `key`。同一个 key 在 CoreGraph 中标识
  Application 与 Page setting。
- Application setting 通过 `ev.config.ts` 中的工厂参数传入。插件支持时，其中可以包含
  只在构建期使用的 callback 或 module reference。
- Page setting 位于 `page.config.ts`。它会跨越静态 CoreGraph 边界，因此必须是普通、
  JSON 可序列化的 object。
- Page object 不继承、不合并 Application 字段。
- 在同一份合同内，显式字段会先深度合并到 defaults，再进行校验。

插件配置只存在于 Application 与 Page scope。Page-aware 插件从 normalized Page graph
派生 Route 或 Document 行为；应用不需要配置单独的 Route/Document plugin surface。

## 按 Scope 启用或禁用

两种工厂写法都会安装并执行插件，也会解析同一份类型安全 Application options；
它们只在 Page 中省略 key 时表现不同：

| 写法 | 结果 |
|---|---|
| `analytics(config)` | 安装并执行插件。Page 有 defaults 时，省略 key 会使用 defaults；否则该 Page 关闭。 |
| `analytics.withPageOptIn(config)` | Page 合同有 defaults 时，使用同一份 Application options 安装并执行插件，但要求每个 Page 显式启用。 |
| `plugins` 中的 `false`、`null` 或 `undefined` | 条件式省略整个插件；不执行任何插件 hook。 |
| `analytics(config)` 后 Page 省略 key | Page 合同有 defaults 时用 defaults 启用；否则关闭该 Page。 |
| `analytics.withPageOptIn(config)` 后 Page 省略 key | 即使 Page 有 defaults，也关闭该 Page。 |
| `analytics: false` | 在该 Page 禁用。 |
| `analytics: true` | 使用 Page `defaults` 启用；合同没有 defaults 时会报错。 |
| `analytics: { ... }` | 将 object 合并到 Page defaults，校验后启用该 Page。 |

只在选定 Page 启用时，使用 `withPageOptIn()`：

```ts
// ev.config.ts
export default defineConfig({
  plugins: [analytics.withPageOptIn({ endpoint: "/events" })],
});
```

再在需要的 Page 中启用：

```ts
// src/pages/checkout/page.config.ts
export default definePageConfig({
  plugins: {
    analytics: true,
  },
});
```

`true` 要求 Page 合同提供 defaults。如果插件要求显式 Page setting，则直接提供 object：

```ts
export default definePageConfig({
  plugins: {
    analytics: { channel: "checkout" },
  },
});
```

需要广泛启用、只排除少数 Page 时，为 Page 合同提供 defaults，正常安装插件，再在
例外 Page 中设置 `analytics: false`。没有 defaults 的 Page 合同始终把省略视为关闭，
并要求通过 object 启用 Page。

对于构建期条件，直接使用 falsy 数组项：

```ts
plugins: [process.env.ANALYTICS === "1" && analytics(options)]
```

可能进入 falsy 分支的插件并不保证安装，因此不会向 Page config 暴露 key。这种写法
适用于没有 Page setting 的整插件条件。Page 需要配置插件时，应确定性安装插件，再用
`analytics: false` 或 `withPageOptIn()` 控制 Page 级启用。

Plugin key 只从 `defineConfig()` 推导出的 tuple 中确定存在的条目生成。宽化后的 plugin
array、在多个 array 之间做条件选择，或在多个完整 config object 之间做条件选择，都
无法证明某个条目一定存在，因此不会向 Page config 暴露 key。需要 Page 配置的插件应
直接保留在 `defineConfig({ plugins: [...] })` tuple 中。

## 类型安全与校验

TypeScript 会在 authoring site 检查 Application 工厂参数与 Page value。插件还可以在
evjs 解析配置和分析 graph 时，同步校验两份合同。

Page value 与解析后的 Page defaults 必须保持 static JSON。function、symbol、bigint、
非有限数值、class instance、稀疏数组与循环引用都会被拒绝。Runtime projection 是插件的
显式职责，插件不能泄露 Application 配置中的 secret。

## 继续阅读

| 目标 | 文档 |
|---|---|
| 定义类型安全的插件和 Application/Page 合同 | [插件开发](./plugin-authoring) |
| 选择并实现生命周期 hooks | [插件 Hooks](./plugin-hooks) |
| 生成模块并挂载到 framework slots | [Generated Contributions IR](./generated-contributions) |
| 从聚焦的实现示例开始 | [插件配方](./plugin-recipes) |
| 配置官方微前端桥接 | [qiankun](./qiankun) |
