# evjs Core 0.3 设计 RFC

状态：authoring 方向已接受，实现与 adapter 覆盖按阶段落地。

本文定义 SPA 与 MPA 共用的 Core 0.3 Page-and-Route 模型，也定义 Bigfish、
Smallfish 与 evjs 0.2 源码模型如何迁往 canonical authoring。

## 决策

Core 0.3 只有一种 canonical Page 模型：

```text
src/pages/
├── page.tsx
├── page.config.ts
├── about/
│   └── page.tsx
└── users/
    └── $userId/
        ├── page.tsx
        ├── page.config.ts
        └── components/
            └── Profile.tsx
```

- `page.tsx` 是 positive Page 与客户端 route 锚点。
- 所在目录是 Page ownership scope，并决定 URL。
- 同目录可选 `page.config.ts` 是构建期 Page 配置。
- `routing.mode` 为同一棵 semantic Page/Route 树选择 SPA 或 MPA 物化。
- 包括 `index.tsx` 在内的同目录文件都是普通 Page 私有源码。
- 插件持有的 Page 配置放在 namespaced `extensions` 中。
- Core `title` 与 named `meta` 由框架物化；插件必须显式投影自己在 runtime
  需要的 extension data 或行为。

最小应用配置：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa", // 或 "mpa"
  },
});
```

canonical 模型中没有第二棵 `application.routes`，也没有 SPA/MPA 各自的 Page
文件名。

## 目标

1. Bigfish SPA 与 Smallfish MPA 应用迁移时，无需先接受第三种 Page ownership
   模型。
2. Page 身份、scope、Route 身份与 Page 能力数据在两种 mode 中含义一致。
3. 构建期配置与可执行 runtime 代码明确分离。
4. 插件获得稳定、namespaced 的 Page 配置和 normalized graph owner。
5. 明确源码迁移方式，不把存量框架方言变成永久 runtime reader。

Core 0.3 不承诺 Bigfish 或 Smallfish API 一比一兼容。目标是让核心心智对等：
应用 mode、Page/Route 定义、Page 私有代码、页面级能力和插件迁移边界。

## 源码调研结论

设计依据是当前 Bigfish 与 Smallfish 的源码行为，而不只是公开 API 名称。

### Bigfish

Bigfish 当前存在多条 Page config 链路：

- 显式 SPA route 配置可被构建插件读取，也会序列化到 runtime route object；
- 约定式 SPA `routeProps` 在浏览器 runtime 中被 bundle 并 spread 到 route
  definition，构建插件拿不到同一份 concrete value。

这会让迁移产生歧义：看起来相同的 Page metadata 可能是 build-time data、
runtime route data，或者二者皆是。Core 0.3 用唯一的构建期 `page.config.ts`
替代 canonical 多链路，并要求显式 runtime projection。

### Smallfish

Smallfish 发现直接子级 Page 目录的 `index.*`，读取 `config.json`，合并 Page
default，并在生成 entry/HTML 前创建 Page instance。插件扩展 Page schema，再决定
各字段如何影响 HTML、生成 entry 代码或 server/runtime data。

真正应该保留的 invariant 不是 JSON 文件名，而是：配置属于稳定 Page owner，并在
插件物化输出前完成解析。Core 0.3 保留这一点，同时把 canonical authoring 迁移到
有类型、namespaced 的 `page.config.ts`。

## Canonical Page 与 Route 约定

每个恰好包含一个受支持 `page.*` module 的目录，创建一个 Page 和一条 semantic
client Route：

```text
<routing.dir>/**/page.{ts,tsx,js,jsx}
```

`routing.dir` 默认是 `./src/pages`。route segment 来自目录：

| 目录 | Semantic path |
| --- | --- |
| `src/pages/page.tsx` | `/` |
| `src/pages/users/page.tsx` | `/users` |
| `src/pages/users/$userId/page.tsx` | `/users/:userId` |
| `src/pages/files/$...splat/page.tsx` | `/files/*` |
| `src/pages/(account)/settings/page.tsx` | `/settings` |

只有 `page.*` 是锚点。完整所在目录属于该 Page；后代目录出现另一个 `page.*`
时才建立新的 Page scope：

```text
src/pages/orders/$orderId/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── request.server.ts
└── components/
    └── Summary.tsx
```

Private scope 是框架 ownership/discovery 边界，不是 JavaScript 访问控制，不再要求
`_` 前缀。

## `page.config.ts` 契约

推荐写法：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "结算",
  meta: {
    description: "确认并完成订单。",
    keywords: "结算,订单",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/analytics": {
      channel: "checkout",
      enabled: true,
    },
  },
});
```

也支持 `page.config.js`。一个 Page 目录只能包含一种受支持的 config 变体。

### 求值

evjs 在构建 graph 时求值该 module：

- module 必须 default-export plain object；
- 求值是同步、build-only 的；
- 可使用 TypeScript 和项目内 import；
- 项目内传递依赖会成为 graph/watch input；
- 求值结果必须是 static JSON data；
- 未知顶层字段会报错。

结果不能包含 function、Promise、symbol、bigint、非有限数字、class instance、
accessor、稀疏数组、循环引用或不安全 object key。`definePageConfig()` 只是用于
类型推导的 identity helper，不会把求值推迟到 runtime。

因此该 module 应保持确定性、无副作用。Secret 和 request-specific value 不应放入
其中。

### Core 字段

Core 持有以下 author-facing Page 字段：

| 字段 | 含义 |
| --- | --- |
| `title` | 静态 Page 文档标题。 |
| `meta` | 物化为 `<meta name="key" content="value">` 的静态字符串 record。 |
| `render` | `"csr"`、`"ssr"` 或 `"ssg"`；默认 `"csr"`。 |
| `hydrate` | `"none"`、`"load"`、`"visible"` 或 `"idle"`。 |
| `prerender` | `true` 或 `{ partial?, delivery?, revalidate? }`。 |
| `rsc` | `true` 表示使用 RSC component model。 |

`meta` 覆盖 `description`、`keywords`、`viewport`、`theme-color` 等 named
metadata；它不建模 `property`、`charset`、`link`、`script`、可执行/动态
metadata 或通用 head DSL。title、meta name 与 meta content 都是静态构建期
数据。

Title/meta 按 Page ownership 物化：

- MPA 或 SSG Page 物化缺失的 title/meta tag，并覆盖其 Document 模板中匹配的
  title 与 `meta[name]`；未声明值保留模板 baseline；
- SPA 使用最深层 active Page，不继承父 Page metadata；导航时恢复模板 baseline，
  或清除下一个 Page 未声明的值；
- MPA Page 同目录 `index.html` 仍是模板 baseline，不是第二套 metadata 模型；
- plugin `transformHtml` hook 在框架元信息物化后运行，可显式覆盖生成 HTML。

构建会校验组合：

- RSC 要求 `render: "ssr"`，并省略 `hydrate` 或设置为 `"none"`；
- partial prerendering 要求 `render: "ssr"`；
- 一个 Page 不能同时启用 RSC 与 partial prerendering；
- full prerendering 必须显式使用 `"ssr"` 或 `"ssg"` render mode。

这些值先 normalize 到 CoreGraph rendering extension，再进入已有 rendering
BuildPlan；它们不会改变 Page 或 Route 身份。如果所选 backend 无法物化某个组合，
adapter/runtime 仍可明确拒绝。

`page.tsx` 中静态导出的 `render`、`hydrate`、`prerender` 和 `rsc` 不是 canonical
配置。迁移后的应用运行 Core 0.3 前，必须把这些 setting 移入
`page.config.ts`。

### 插件 extension

插件持有的数据必须使用全局 namespaced key：

```ts
export default definePageConfig({
  extensions: {
    "@company/tracert": {
      spm: "a1.b2",
    },
    "@company/access": {
      role: "operator",
    },
  },
});
```

每个 namespace 必须由唯一的插件 `pageExtension()` declaration 注册。
插件持有 default、merge、validation 和 schema version：

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const accessPlugin = definePlugin({
  name: "@company/access-plugin",
  describe(api) {
    api.pageExtension({
      namespace: "@company/access",
      defaults: { role: "guest" },
      validate(value) {
        return typeof value.role === "string" || "role must be a string";
      },
    });
  },
  contributions(ctx) {
    for (const page of ctx.framework.pages) {
      const access = page.extensions["@company/access"];
      // 只生成该能力真正需要的 build/runtime artifact。
      console.log(page.id, access);
    }
  },
});
```

未注册 namespace 会报错，两个插件也不能持有同一 namespace。

### 构建期与运行时 phase

`page.config.ts` 不会作为浏览器 module 打包。Core 会提取并物化支持的
title/meta/rendering 字段；完整 config object 与 plugin extension 不会自动
序列化到 HTML、route object 或全局 runtime manifest。

```text
page.config.ts
  -> 构建期静态求值
  -> 校验 core 字段和已注册 extension namespace
  -> normalized CoreGraph Page 字段与 extensions
  -> core title/meta/rendering 物化
  -> 可选的显式 plugin runtime projection
```

纯构建插件可在 graph 或 HTML generation 结束。runtime 能力必须显式 emit 最小
data/module，并通过受支持 generated contribution 挂载。这样可避免 secret 和
build-only 字段进入浏览器 bundle，也让 runtime 成本可被 inspect。

当前 generated-contribution API 仍有 topology-specific entry/Document target。
插件不能假设每个 SPA Page 都有独立 entry，或每个 SPA Page 都持有 HTML
Document。Topology-neutral `page.module` 与 `page.activation` facet 属于下一阶段
插件迁移。

## Normalized Core 模型

canonical discovery 与显式 route-tree normalizer 生成相同 owner：

```text
CoreGraph
├── Application
├── Page
├── Route
├── Document
└── extension registry
```

Page 记录 component module、可选 config source、目录 scope、所属 Application、
extension 与 provenance。Route 指向 Page、redirect、group 或 Document，但自身
不是 Page。Document 独立持有 template/output/bootstrap concern。

两种 mode 中的差异：

| Semantic owner | SPA 物化 | MPA 物化 |
| --- | --- | --- |
| Application | 一个 browser application 和 route tree | 跨 Page entry 的一个逻辑 owner |
| Page | 一个 Client Route 的 target | 一个独立 Page entry 的 owner |
| Route | Client Route | 支持范围内的静态 Document Route |
| Document | 通常由 Application 持有 | 通常每个 Page 持有一个 Document |
| Page config | 相同 normalized Page title/meta/rendering/extensions | 相同 normalized Page title/meta/rendering/extensions |

切换 `routing.mode` 可以改变 entry 与 Document，但不能重命名 Page、改变 source
scope 或选择另一套配置方言。

## SPA 与 MPA 页面级配置

两种 mode 都发现相同的同目录 config module：

```text
src/pages/report/
├── page.tsx
└── page.config.ts
```

SPA 中，title/meta、rendering 字段与 extension 附着在 browser route tree
指向的 Page 上。最深层 active Page 持有 title/meta，不继承父 Page metadata。
MPA 中，同一个 Page 持有独立 entry 与 Document，title/meta 物化缺失 tag 并
覆盖匹配的模板 baseline。插件在两种 mode 中看到相同 Page id 和 extension
value；只有 output attachment 可能不同。

Page config 不持有 URL、Page component path 或 Page identity；这些由
`page.tsx` 锚点及目录决定。它也不替代共享 HTML template 或 MPA Page 同目录的
`index.html`；这些模板提供 baseline document markup。

## 迁移输入

迁移支持用于降低转换成本，但不会形成更多 canonical 模型。

| 存量来源 | 必需迁移 | Canonical 目标 |
| --- | --- | --- |
| Bigfish 显式 SPA route config | 现有显式 route tree 可暂时 normalize `component`、`children`、wrapper、layout 与 redirect；它自身表示 SPA，不能与 `routing` 同时声明，并拒绝 MPA topology。插件持有的 route metadata 不会被隐式复制。 | 把每个 Page 移到 URL 对应目录并命名为 `page.tsx`；Page 能力移到 `page.config.ts`；插件持有的静态值移入已注册 extension；删除 `application` 后，只用 `routing.mode: "spa"` 启用 canonical tree |
| Bigfish 约定式 `routeProps` | 静态能力数据移入已注册 `extensions`；插件显式投影 runtime data | 使用 canonical Page tree 与 namespaced `page.config.ts` extension |
| Smallfish directory Page | 把每个直接子级 `index.*` entry 重命名或移动到公开 URL 对应目录并命名为 `page.tsx`；把 `config.json` title 与受支持 named meta 映射到 core `title`/`meta`，其余插件持有值移入 extension，并删除 `config.json` | 使用 canonical Page tree 与 `routing.mode: "mpa"` |
| evjs 0.2 recursive route | 把每个已发布 filename route 移到 URL 对应目录并命名为 `page.tsx`；把 component rendering export 与 Page setting 移入 `page.config.ts` | 使用 canonical Page tree，并且只配置 `routing.mode` |
| `application.routes`，以及已移除的 `app`、`pages`、顶层 `routes` | Bigfish SPA tree 迁移期只暂时保留 `application.routes`；已移除声明产生迁移错误 | 优先使用 canonical Page tree；standalone runtime 在 Framework config 外持有自己的 entry |

新的 canonical Page 不应创建 `config.json`。在同一次源码迁移中，把静态文档
title 与受支持 named meta 映射到 core `title`/`meta`，其他能力 owner value
移入 namespaced `page.config.ts` extension。

显式 route-tree normalizer 在 Page extension 执行前保留 source
provenance。Smallfish 与 evjs 0.2 源码转换必须在 canonical discovery 前完成；
任意 `src/pages` 文件都不会选择另一种 runtime reader。

## 迁移顺序

对于存量应用：

1. 盘点现有公开 URL、Page entry 与 Page-owned setting。
2. 为每个已发布 Page 建立稳定 Page 目录。
3. 移动或重命名 Page component entry 为 `page.tsx`。
4. 普通 Page 私有代码放在旁边；`_` 前缀可按需移除。
5. 创建 `page.config.ts`，把静态 title/named meta 与 rendering setting 移入
   core 字段，把插件持有值移入 namespaced extension。
6. 在能力所属插件中显式实现 runtime projection。
7. Smallfish 与 evjs 0.2 迁移只配置 `routing.mode`，不要增加 source-reader
   开关。Bigfish 显式 SPA tree 在源码转换完成前保留在
   `application.routes` 下，并且不声明 `routing`。
8. 运行 `ev inspect`，对比 Page/Route/Document graph、generated
   contribution、HTML 与 runtime 行为。Bigfish 文件树 canonical 后，删除
   `application`，再用 `routing.mode: "spa"` 启用它。

## 被拒绝的方案

### 保留三套并列 canonical routing 模型

把 Bigfish config route、Smallfish directory Page 与 evjs filename route 当作
平等公开模型，只会把迁移问题保留在新 core 内。Bigfish 显式 route 可以暂时进入
一个 normalizer；Smallfish 与 evjs 源码树在 canonical discovery 前完成转换。

### 用 `index.tsx` 作为统一锚点

这会重新让普通 barrel/component 产生歧义，也无法解决递归 Page-private discovery。
Positive `page.tsx` marker 可以明确 ownership。

### canonical `config.json`

JSON 无法提供 typed extension inference，也无法说明任意 key 由哪个插件持有。
应把 title 与受支持 named meta 映射到 core `page.config.ts` 字段，其余插件
owner value 移入 namespaced extension，然后删除该文件。

### 在浏览器中 import `page.config.ts`

这会混合 build-time/runtime phase，可能泄漏 build-only value，并迫使所有 Page
config 进入 client bundle。框架只投影受支持的 core title/meta 行为；插件
runtime projection 必须显式。

### 在 Page config 中放 executable function

Function 无法作为稳定 graph data 校验或序列化。可执行行为应位于 Page module，
或通过显式 contribution contract 引用的 plugin-generated runtime module。

## 下一阶段：插件迁移

Page/config 契约稳定后，下一阶段按 semantic owner 与 phase 映射 Bigfish、
Smallfish 插件行为：

- config schema/default/validation -> `describe().pageExtension()`；
- 静态 Page title/named meta -> core Page metadata；
- 插件持有的 Page build metadata -> normalized Page extensions；
- route definition 行为 -> Route facet；
- entry/runtime injection -> Application/Page/Document runtime facet；
- head/script/style/template 行为 -> Document facet；
- server middleware/endpoint -> server request facet；
- 平台部署输出 -> deployment/output extension。

迁移目标不是 hook-name emulator，而是提供足够的 semantic coverage，让存量插件
可以逐能力迁移，无需重建自己的 Page ownership 模型。
