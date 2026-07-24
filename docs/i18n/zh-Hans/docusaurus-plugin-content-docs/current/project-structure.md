# 项目结构

本页是 evjs 应用文件约定的事实来源。

Core 0.3 使用唯一的 positive Page-and-Route 约定：

- `src/pages/**/page.*` 是唯一 canonical Page 与客户端 route 锚点；
- 所在目录同时决定 Page scope 与 URL；
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
    ├── middleware.ts
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
    │       └── health.ts
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

## 约定发现边界

顶层 `conventions: false` 会把框架持有的文件系统约定作为一个整体关闭：
`page.*` 锚点、`src/apis` 下的 server route、全局 `src/middleware.ts`，以及
route-scoped `src/apis/**/middleware.ts`。它不能和显式 `routing` 或
`server.routing` 声明一起配置。evjs 不提供只关闭其中某个 root 或 facet 的开关。

```ts
export default defineConfig({
  conventions: false,
});
```

仅支持 SPA 的 `application.routes` migration input 是配置输入，不是文件约定。
reachable 的 `"use server";` 模块与插件生成的 contribution 是 graph 输入，也
不是文件系统约定；关闭约定发现后，这些输入仍然可用。已移除的 `app`、`pages`
和顶层 `routes` 声明会产生迁移错误。

文件约定启用时，可以通过 `server.routing: { dir }` 把 server file-route root
从 `src/apis` 移到其他目录；该配置只定制 root，不关闭发现。

## 约定矩阵

创建应用文件时以此矩阵为准。路径都相对项目根目录。

| 路径或声明 | 框架含义 | Scope / 输出 | 说明 |
| --- | --- | --- | --- |
| `ev.config.ts` | 框架配置 | 整个项目 | 从 `@evjs/ev` 导入 `defineConfig`。 |
| `conventions: false` | 关闭框架文件发现 | 整个项目 | 一次性关闭 Page/Route 锚点、server file route 与全局/route middleware。 |
| `routing.mode` | 输出物化模式 | Application | `"spa"` 创建 Client Route；`"mpa"` 创建 Page-owned Document。它不选择另一套路由模型。 |
| `routing.dir` | Page-route 根目录 | Application | 默认 `./src/pages`；新应用通常无需配置。 |
| `<routing.dir>/**/page.{ts,tsx,js,jsx}` | canonical Page 与 Route 锚点 | 完整所在目录 | 每个 route 目录只允许一个源码扩展名变体；默认导出 Page 组件。 |
| `<Page 目录>/page.config.{ts,js}` | 可选 canonical Page 配置 | Build graph | Default-export static Page config；推荐 `definePageConfig()` 与 `page.config.ts`，每个 Page 只能有一个变体。 |
| `<routing.dir>/**/$param/` | 动态 route segment | Route path | 产生 semantic `:param` segment。 |
| `<routing.dir>/**/$...splat/` | Catch-all route segment | Route path | 必须位于末尾。 |
| `<routing.dir>/**/(group)/` | Pathless route group | 源码组织 | 参与 scope，但不增加 URL segment。 |
| `<routing.dir>/layout.*` 与 nested `layout.*` | Route layout facet | Semantic route tree | SPA 与 MPA 物化都会为后代组合 layout。 |
| `<routing.dir>/**/error.*` 与 `not-found.*` | Route boundary facet | SPA route tree | 在具备明确 Document contract 前，MPA 会拒绝这些 router-only facet。 |
| Page 目录下其他文件 | Page 私有源码 | 最近的 Page | 组件、hook、model、service、测试、样式、资源与 `index.*` 都不会创建 route。 |
| `<Page 目录>/index.html` | Page Document 模板 | MPA Page 输出 | 覆盖该 MPA Page 的共享模板，不是客户端 Page entry。 |
| `index.html` / `routing.html` | Document template | Application 输出 | `index.html` 是默认模板，与 Page entry 文件名无关。 |
| `src/route-types.d.ts` | SPA 文件路由导航类型（生成时） | 生成产物 | 忽略且不要复制到 scaffold 或从应用源码 import。 |
| 带 `"use server";` 的 `**/*.server.*` | Server-function 模块 | Reachability graph | 只支持命名可调用导出，不要求固定目录。 |
| `server.routing: { dir }` | Server file-route root 定制 | Application | 文件约定启用时默认 `./src/apis`；它不是关闭开关。 |
| `src/apis/**/*.{ts,tsx,js,jsx}` | Server file route | 请求 URL | 使用大写 HTTP method export，URL 来自文件路径。 |
| `src/middleware.ts` | 全局 server middleware | Server runtime | 包裹框架持有的 server 请求。 |
| `src/apis/**/middleware.ts` | API route middleware | 后代 server file routes | 自身不是 route。 |
| `public/**` | 静态文件 | 客户端输出 | 按 output 配置复制。 |
| `components/`、`features/`、`hooks/`、`lib/` | 共享应用源码 | Application/shared | 普通项目组织，不是框架约定。 |

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

不再有需要同步维护的第二份 route map：Page 目录同时是身份与 URL 的稳定来源。
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
`@evjs/ev/navigation` 渲染 `Outlet`。部分 MPA 动态路由与 React facet 的物化
仍在分阶段完成；`ev inspect` 和 `ev build` 会报告不支持的组合，而不会选择
另一套 authoring convention。

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

### Page 配置与 extension

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
  extensions: {
    "@company/analytics": {
      channel: "orders",
    },
  },
});
```

Core 字段包括静态 Page `title`、named `meta`、`render`、`hydrate`、
`prerender` 与 `rsc`。每个 `meta` 项都会生成
`<meta name="key" content="value">`；它不表示 `property`、`charset`、
`link`、`script`、动态元信息或任意 head DSL。插件持有的值放在
`extensions` 下，并使用已注册 namespaced key。求值结果必须是 static JSON
data。Core title/meta 会为当前 Page 物化；extension value 会进入 normalized
graph，但能力所属插件仍须通过 generated contribution 显式投影 runtime data
或行为。

## Server 边界

客户端 Page routing 与服务端 request routing 是独立系统。

Server file route 使用 `src/apis`，动态文件段用 `$param`，目录根用 `index`，
pathless 组织用 `(group)`：

```text
src/apis/
├── middleware.ts
├── api/
│   ├── health.ts
│   └── users/
│       ├── index.ts
│       └── $userId.ts
└── (internal)/
    └── metrics.ts
```

```ts
export function GET({ params }: { params: { userId: string } }) {
  return Response.json({ id: params.userId });
}
```

Server route module 只导出大写 HTTP method。没有 route export 的 helper file
仍是普通源码。不要添加 `route.ts` sentinel、method suffix file、bracket
route、catch-all、optional param、route-module middleware export 或
`server.entry` composition path。

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

不要编辑或复制到模板。

## 迁移存量应用

Core 0.3 不会选择 Smallfish 或 evjs 0.2 runtime reader。启动应用前先一次性转换
源码树。客户端 Page discovery 只在应用声明 `routing.mode` 后开始；仅存在无关的
`src/pages` 目录不会发布 route。

| 存量来源 | 迁移动作 | canonical 目标 |
| --- | --- | --- |
| Bigfish SPA route config / `application.routes` | 显式 SPA route tree 可暂时进入 migration normalizer，并且自身就表示 SPA；它不能与 `routing` 同时声明，MPA topology 会被拒绝 | 把每个 route component 移到对应 URL 目录并命名为 `page.*`；删除 `application` 后，只用 `routing.mode: "spa"` 启用 canonical tree |
| Smallfish 直接子 Page 目录 | 运行 Core 0.3 前，保留或调整 URL 目录，把 `<page>/index.*` 重命名为 `page.*` | 保留 `routing.mode: "mpa"`；把 `config.json` 的 title 与受支持 named meta 映射到 core `title`/`meta`，其余插件持有值移入 namespaced extension |
| evjs 0.2 递归路由 | 运行 Core 0.3 前，把每个已发布 filename route 移到 URL 对应目录并命名为 `page.*` | 保留 dynamic/group 目录段，把 Page setting 移到 `page.config.ts`，并且只配置 `routing.mode` |
| Core 0.3 `page.*` preview | 通过之前的实验性 selector 读取 positive file-route anchor | 保留文件树，移除 preview selector，只声明 `routing.mode` |

Provider name 只可能出现在 raw CoreGraph/debug artifact 中作为内部 provenance。
普通 inspect routing 输出会隐藏它；应用不会选择 provider 作为架构模式。

## 命名建议

- route 目录按稳定公开 URL 命名。
- 新 URL segment 默认使用小写，除非必须保留已有公开 URL 大小写。
- 使用 `$param`、终止 `$...splat` 与 `(group)` 目录段。
- Page 私有代码放入 Page 目录。
- 多个 Page 共用的业务模块放到 `routing.dir` 外。
- 静态文档标题和 named meta 放在 core `title` 与 `meta` 字段中；业务或插件能力
  数据放在 namespaced `page.config.ts` extension 中。
- 映射受支持的 title/meta，并把其余 owner value 移入 `page.config.ts` 后，
  删除旧 `config.json`。
