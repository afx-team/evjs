# 项目结构

本页是 evjs 应用文件约定的事实来源。

evjs 为客户端 Page 与服务端 request Route 使用对称的 positive anchor：

- `src/pages/**/page.*` 是唯一 canonical Page 与客户端 route 锚点；
- `src/apis/**/api.*` 是唯一 server request-route 锚点；
- 每个锚点的完整所在目录同时决定 scope 与 URL；
- 同一棵文件树在 SPA 和 MPA 中产生相同 semantic Page/Route；
- `routing.mode` 只改变物化方式，不改变 Page 或 Route 身份。

## 推荐结构

```text
my-evjs-app/
├── ev.config.ts
├── index.html
├── package.json
├── tsconfig.json
├── public/
└── src/
    ├── middlewares/
    │   ├── middleware.ts           # 有序的全局组合锚点
    │   └── authentication.ts       # 普通 middleware 模块
    ├── pages/
    │   ├── page.tsx                 # /
    │   ├── page.config.ts          # / 的可选构建期配置
    │   ├── layout.tsx               # SPA 与 MPA 的根 layout
    │   ├── about/
    │   │   └── page.tsx             # /about
    │   ├── users/
    │   │   ├── page.tsx             # /users
    │   │   ├── page.config.ts       # 可选 Page 能力
    │   │   ├── model.ts
    │   │   ├── components/
    │   │       ├── Hero.tsx
    │   │       └── index.tsx       # 私有 barrel/component，不是 Page
    │   │   └── $userId/
    │   │       ├── page.tsx         # /users/:userId
    │   │       └── services.ts
    │   └── (account)/
    │       └── settings/
    │           └── page.tsx         # /settings
    ├── apis/
    │   ├── middleware.ts
    │   ├── users.server.ts
    │   └── api/
    │       └── health/
    │           └── api.ts            # /api/health
    ├── components/
    ├── features/
    ├── hooks/
    └── lib/
```

对应的 SPA 声明：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

MPA 保留同一棵 Page 树，只改变物化模式：

```ts
export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

语义 Page route 仍是 `/`、`/about` 与 `/foo/bar`。MPA 的静态输出和请求时渲染
都通过 `/index.html`、`/about.html` 与 `/foo/bar.html` 暴露对应 Document。

## 约定发现边界

顶层 `conventions: false` 会把框架持有的文件系统约定作为一个整体关闭：
`page.*` 锚点、`src/apis` 下的 `api.*` 锚点、全局
`src/middlewares/middleware.*`，以及
route-scoped `src/apis/**/middleware.ts`。它不能和显式客户端 `routing` 声明一起
配置。evjs 不提供只关闭其中某个 root 或 facet 的开关。

```ts
export default defineConfig({
  conventions: false,
});
```

仅支持 SPA 的 `application.routes` 是显式 route-tree 配置输入，不是文件约定。
reachable 的 `"use server";` 模块与插件生成的 contribution 是 graph 输入，也
不是文件系统约定；关闭约定发现后，这些输入仍然可用。

文件约定启用时，server file-route root 固定为 `src/apis`。

## 约定矩阵

创建应用文件时以此矩阵为准。路径都相对项目根目录。

| 路径或声明 | 框架含义 | Scope / 输出 | 说明 |
| --- | --- | --- | --- |
| `ev.config.ts` | 框架配置 | 整个项目 | 从 `@evjs/ev` 导入 `defineConfig`。 |
| `conventions: false` | 关闭框架文件发现 | 整个项目 | 一次性关闭 Page/Route 锚点、server file route 与全局/route middleware。 |
| `routing.mode` | 输出物化模式 | Application | `"spa"` 创建 Client Route；`"mpa"` 为静态 Page path 创建 Page-owned Document。它不选择另一套路由模型。 |
| `src/pages/**/page.{ts,tsx,js,jsx}` | canonical Page 与 Route 锚点 | 完整所在目录 | Page 根目录固定；每个 route 目录只允许一个源码扩展名变体；默认导出 Page 组件。 |
| `<Page 目录>/page.config.{ts,js}` | 可选 canonical Page 配置 | Build graph | Default-export static config；core metadata/rendering 字段和类型安全的 `plugins` map 属于 Page；`document.aliases` 增加经过校验的静态输出文件名，但不会增加 Route。推荐 `definePageConfig()` 与 `page.config.ts`，每个 Page 只能有一个变体。 |
| `src/pages/**/$param/` | 动态 route segment | Route path | 产生 semantic `:param` segment。 |
| `src/pages/**/$...splat/` | Catch-all route segment | Route path | 必须位于末尾。 |
| `src/pages/**/(group)/` | Pathless route group | 源码组织 | 参与 scope，但不增加 URL segment。 |
| `src/pages/layout.*` 与 nested `layout.*` | Route layout facet | Semantic route tree | SPA 与 MPA 物化都会为后代组合 layout。 |
| `src/pages/**/error.*` 与 `not-found.*` | Route boundary facet | SPA route tree | MPA 会拒绝这些 router-only facet。 |
| Page 目录下其他文件 | Page 私有源码 | 最近的 Page | 组件、hook、model、service、测试、样式、资源与 `index.*` 都不会创建 route。 |
| `<Page 目录>/index.html` | Page Document 模板 | MPA Page 输出 | 覆盖该 MPA Page 的共享模板，不是客户端 Page entry。 |
| `index.html` / `routing.html` | Document template | Application 输出 | `index.html` 是默认模板，与 Page entry 文件名无关。 |
| `src/route-types.d.ts` | SPA 文件路由导航类型（生成时） | 生成产物 | 忽略且不要复制到 scaffold 或从应用源码 import。 |
| `src/plugin-types.d.ts` | `ev.config.ts` 静态类型桥 | 生成产物 | 忽略；Page config 会自动消费其 augmentation，无需 import 插件包。 |
| 带 `"use server";` 的 reachable 源码 module | Server-function 模块 | Reachability graph | 只支持命名可调用导出，不要求固定目录或文件后缀；推荐用 `.server.*` 提高可读性。 |
| `src/apis/**/api.{ts,tsx,js,jsx}` | Server request Route 锚点 | 完整所在目录 | Server route root 固定；每个 route 目录只允许一个源码扩展名变体；只导出 callable 的大写 HTTP method handler。注册顺序按 segment 逐段比较 specificity，在首个不同位置优先 static segment。 |
| Server route 目录下其他文件 | Route 私有源码 | 最近的 server Route | Helper、schema、store、测试与 `index.*` 都不会创建 route。 |
| `src/middlewares/middleware.{ts,tsx,js,jsx}` | 全局 server middleware 组合锚点 | Server runtime | 默认导出一个 middleware 函数，或按明确执行顺序排列的非空列表。TypeScript 列表使用 `satisfies MiddlewareChain` 提供类型。只允许一个源码扩展名变体。 |
| `src/middlewares` 下的其他文件 | 全局 middleware 实现源码 | Application-private | 由组合锚点导入的普通模块。文件名不决定顺序。 |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | API route middleware | 同目录及后代 server file routes | 默认导出一个 middleware 函数；自身不是 route。 |
| `public/**` | 静态文件 | 客户端输出 | 按 output 配置复制。 |
| `components/`、`features/`、`hooks/`、`lib/` | 共享应用源码 | Application/shared | 普通项目组织，不是框架约定。 |

全局 middleware 顺序由源码控制，而不是由文件名控制：

```ts
// src/middlewares/middleware.ts
import type { MiddlewareChain } from "@evjs/ev/server-context";
import authentication from "./authentication";
import tracing from "./tracing";

export default [tracing, authentication] satisfies MiddlewareChain;
```

请求从左到右进入 middleware；`await next()` 之后的代码从右到左回退执行。
默认导出单个 middleware 函数也合法。

### canonical Page 与 Route 解析

对于锚点：

```text
src/pages/people/$personId/page.tsx
```

evjs 解析得到：

```text
Page entry    src/pages/people/$personId/page.tsx
Page scope    src/pages/people/$personId/
URL           /people/:personId
```

没有需要同步维护的第二份 route map：Page 目录同时是身份与 URL 的稳定来源。
Core 会另外派生 build-safe 内部 id。SPA 与 MPA 先把这份源码 normalize 为
相同 semantic Page/Route 节点，再选择不同 runtime/output projection。

### Page 私有代码

Page 目录下的一切都属于该 Page，除非某个后代目录包含另一个 `page.*` 锚点：

```text
src/pages/orders/$orderId/
├── page.tsx
├── page.config.ts
├── index.ts
├── loader.server.ts
├── model.ts
├── components/
│   └── Summary.tsx
└── __tests__/
    └── detail.test.tsx
```

普通私有代码不需要 `_` 前缀。Private scope 是 ownership 边界，不是访问控制；
JavaScript import 仍遵循普通模块规则和可选 lint 工具。`index.*` 没有客户端
route 含义；后代 `page.*` 会有意创建另一个 Page，并让其目录成为更具体的 scope。

`_` 不表示私有 route。`_components/` 这类目录只是因为没有 `page.*` 锚点而保持
普通源码；如果存在 `_private/page.tsx`，discovery 会把它报告为无效 static URL
segment，而不是静默隐藏该 Page。Static segment 必须以字母或数字开头。

### 路由树

目录嵌套就是 route tree：

```text
src/pages/
├── page.tsx                       # /
└── admin/
    ├── layout.tsx                 # SPA 与 MPA 的 /admin 子树 layout
    ├── page.tsx                   # /admin
    ├── members/
    │   └── $memberId/
    │       └── page.tsx           # /admin/members/:memberId
    └── (settings)/
        └── profile/
            └── page.tsx           # /admin/profile
```

SPA 与 MPA 物化都会为后代 Page 组合 layout。SPA Page route 还可以从
`@evjs/ev/navigation` 渲染 `Outlet`。MPA 会拒绝 `$param` 与终止
`$...splat` route，因为动态 pattern 不能唯一对应一个构建期 HTML 输出；
router-only boundary facet 也只支持 SPA。`ev inspect` 和 `ev build` 会报告
这些组合，而不会选择另一套 authoring convention。

## Page 模块

React Page 默认导出组件：

```tsx
export default function UserDetailPage() {
  return <main>User detail</main>;
}
```

Page 代码使用公开 authoring subpath：

```tsx
import { usePageParams } from "@evjs/ev/route";
import { Link, useNavigate } from "@evjs/ev/navigation";
import { useQuery } from "@evjs/ev/query";
```

具体 API 参见[客户端路由](./client-routes)和[服务端函数](./server-functions)。

### Application 与 Page 插件 scope

Application 在 `ev.config.ts#plugins` 中安装并配置插件：

```ts
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/evjs-plugin-analytics";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [analytics({ endpoint: "/events" })],
});
```

工厂调用是唯一的 Application 级插件配置入口。参数由插件包提供类型；插件合同
明确允许时，也可以包含可执行选项。

已安装且支持 Page 配置的插件会在相邻 `page.config.ts#plugins` map 中暴露其
canonical `id`。
Application 与 Page 是两个独立合同，不会相互合并；authoring 字段只在各自合同
内部深度合并到 defaults。普通工厂调用在 Page 有 defaults 时，会让省略插件项的
Page 使用 defaults；没有 defaults 时则关闭该 Page。defaultable Page 合同还会
暴露 `forPages()`，并始终把省略视为关闭。`false` 对当前 Page 禁用插件，`true`
要求 Page defaults，对象则用独立类型、严格 JSON 的 Page value 启用插件。

`ev prepare`、`ev dev` 与 `ev build` 生成 `src/plugin-types.d.ts`，稳定桥接
`ev.config.ts`。Page config 无需 import 插件包即可获得 plugin id 与字段补全；条件化
或被 widen 的插件数组只暴露静态确定会安装的条目。声明有意生成在 `src` 而不是
`.ev`，因为常规项目 `tsconfig.json` 会包含 `src`。

Route 与 Document 对象不暴露单独的插件配置。Page-aware 插件根据 normalized
Page graph 派生 route pattern、Document ownership 等语义上下文，再显式投影自己
持有的 runtime 或 build contribution。

### Page 配置与插件

同目录 `page.config.ts` default-export 构建期 Page 配置：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "订单管理",
  meta: {
    description: "查看和管理客户订单。",
    keywords: "订单,支付",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  plugins: {
    analytics: {
      channel: "orders",
    },
    access: {
      policy: "canReadOrders",
    },
  },
});
```

Core 字段包括静态 Page `title`、named `meta`、`render`、`hydrate`、
`prerender` 与 `rsc`。省略 `render` 时始终归一化为 CSR，且必须省略
`hydrate`；显式 SSR/SSG Page 可以选择 `"load"` 或 `"none"`。每个 `meta`
项都会生成
`<meta name="key" content="value">`；它不表示 `property`、`charset`、
`link`、`script`、动态元信息或任意 head DSL。Plugin 持有的 Page value 放在
`plugins` 下，并使用 canonical plugin id；解析后的 Page 对象必须是 static JSON
data。
Core title/meta 会为当前 Page 物化；插件值会进入 Page analysis，但能力所属插件
仍须通过 generated contribution 显式投影 runtime data 或行为。

当 Page 持有静态 Document（MPA CSR/SSG 或 SPA SSG）时，可以把同一份
transformed HTML 发布到额外的已校验路径：

```ts
export default definePageConfig({
  document: {
    aliases: ["orders.html", "archive/orders.htm"],
  },
});
```

Alias 不会创建 Page、Route 或额外 Document。它必须是以 `.html` 或 `.htm`
结尾的规范化相对路径，不能等于 canonical output，也不能与其他 canonical output
或 alias 冲突。后缀限制可避免 framework HTML 覆盖 JavaScript、CSS 或部署
metadata。Page 共享 SPA Application Document 或使用请求时渲染时，
Page-specific Document 配置会被拒绝。

## Server 边界

客户端 routing 与服务端 request routing 是独立系统，但共享 request pathname
命名空间。每个占用 URL 的客户端 Route（Page 或 redirect）都必须与 server
request Route pattern 互不相交：static segment 可能与 dynamic segment 相交，
终止 client splat 也会与其 prefix 和后代相交；结构性的 group Route 不占用 URL。
Percent-encoded static alias 按一次 decode 后的 URL 语义比较，因此 `/%75sers`
同样与 `/users` 相交，而双重编码文本仍保持不同。编码后的 `/` 保留在原 segment
内部，绝不会合并 path boundary。显式 client segment 在 decode 后为 `.` 或
`..` 时也会被拒绝，因为 WHATWG URL 解析会在 routing 之前移除它。BuildPlan
会拒绝这些冲突，因为 server request Route 在 runtime 中优先匹配。

Server request Route 使用 `src/apis` 下的 positive `api.*` 锚点。锚点的完整
所在目录决定 URL 与 scope；`$param` 目录表示动态 segment，`(group)` 目录用于
pathless 组织：

```text
src/apis/
├── middleware.ts
├── api/
│   ├── health/
│   │   └── api.ts
│   └── users/
│       ├── api.ts
│       ├── users-store.ts
│       └── $userId/
│           └── api.ts
└── (internal)/
    └── metrics/
        └── api.ts
```

```ts
export function GET(
  _request: Request,
  ctx: { req: { param(name: string): string } },
) {
  return Response.json({ id: ctx.req.param("userId") });
}
```

只有 `api.*` 才是 server request-route 锚点。包括 `index.ts`、`route.ts` 与
method-suffix file 在内的其他 basename 都是普通私有源码，即使它们导出了
`GET` 之类的名字也不会创建 route。锚定的 `api.*` module 只能导出大写 HTTP
method。Local declaration、import/re-export 的 handler、factory 与可变 binding 都是
合法的组合细节；静态已知为 non-callable 的值和 generator 会在 discovery 阶段被
拒绝，求值后的 method value 则在生成的 route module 加载时校验。Default export、
helper export 与 route-module middleware export 都无效。位于 bracket、catch-all、
optional 或其他无效 path segment 下的锚点会被拒绝。`api.*` 是唯一 server
request-route anchor。

Server function 又是另一套机制：任何 reachable、以 `"use server";` 开头并
导出支持的命名 callable 的模块都可定义。参见
[服务端路由](./server-routes)和[服务端函数](./server-functions)。

## 生成结构

`ev prepare`、`ev dev` 和 `ev build` 在 `.ev` 中物化框架 IR，包括 normalized
graph、生成 entry、插件 contribution、framework slot、import edge 和最终
manifest 输入。

以下都是生成物：

- `.ev/`
- `dist/`
- `.turbo/`
- `node_modules/`
- `src/route-types.d.ts`
- `src/plugin-types.d.ts`

不要编辑或复制到模板。

## 路由输入边界

客户端 Page discovery 只在应用声明
`routing.mode` 后开始；仅存在无关的 `src/pages` 目录不会发布 route。显式
`application.routes` 是独立、仅支持 SPA 的配置输入，并归一化到同一 CoreGraph。

| 输入 | 当前语义 | 源码要求 |
| --- | --- | --- |
| `routing.mode` | 发现 canonical Page tree，并选择 SPA 或 MPA 物化。 | 只有 `src/pages/**/page.*` 发布 Page；包括 `index.*` 在内的其他文件都是私有源码。Page 设置放在相邻 `page.config.ts`。 |
| `application.pageRoot` | 显式 SPA route tree 中 `page` 与 `component` 共用的 Page 源码根目录，默认值为 `./src/pages`。 | 只与 `application.routes` 配合使用，不会定制 canonical `src/pages` discovery；`@/pages/...` 指向该配置根目录。 |
| `application.routes` | 接受 `routes` 嵌套（不接受 `children`）、`page` 或 `component` 与 layout/wrapper/redirect 结构。插件配置由 Page 持有，不写在 Route declaration 上。`exact: true` 是 terminal-match 断言；`exact: false` 或带嵌套路由的 `exact: true` 会被拒绝。该输入不能与 `routing` 同时声明，也不能选择 MPA。 | `page` 必须解析到 `application.pageRoot` 下唯一的 `page.*` 锚点；`component` 的逻辑路径和 symlink 真实路径都必须留在同一根目录。`index.*` 或 `page.*` component 持有所在目录；其他 basename 只持有模块本身，且不会消费 `page.config.ts`。layout 与 wrapper 仍是项目源码 reference。 |

## 命名建议

- route 目录按稳定公开 URL 命名。
- 新 URL segment 默认使用小写，除非必须保留已有公开 URL 大小写。
- 使用 `$param`、终止 `$...splat` 与 `(group)` 目录段。
- Page 私有代码放入 Page 目录。
- 多个 Page 共用的业务模块放到各 Page 目录之外。
- 静态文档标题和 named meta 放在 core `title` 与 `meta` 字段中；业务或插件能力
  数据放在 `page.config.ts#plugins` 下对应的 canonical plugin id 中。
- 静态 title、named meta、渲染设置与 Page 插件值统一放在相邻的
  `page.config.ts` 模块中。
