# 文件约定

evjs 的文件约定保持少而明确。一个 positive `page.*` marker 同时定义客户端
Page 与 file route；服务端请求路由继续使用独立约定。

完整矩阵参见[项目结构](./project-structure)。

## 约定根目录

| 根 | 用途 |
| --- | --- |
| `src/pages` 或 `routing.dir` | canonical Page-and-Route 文件树。 |
| `src/apis` 或 `server.routing.dir` | 服务端请求路由模块。 |
| `src/middleware.ts` | 全局框架 server middleware。 |
| `src/apis/**/middleware.ts` | 作用于后代 server file route 的 middleware。 |
| reachable 源码模块 | 以 `"use server";` 开头的 server function。 |

Page 锚点、server file route 与两类 middleware root 共同组成一个框架持有的
发现单元。顶层 `conventions: false` 会整体关闭这个单元，框架不提供逐 root
开关；该配置不能与显式 `routing` 或 `server.routing` 一起使用。文件约定保持
启用时，`routing.dir` 与 `server.routing: { dir }` 只定制各自的 discovery
root。

reachable 的 `"use server";` 模块、仅支持 SPA 的 `application.routes`
migration input，以及插件 contribution 是 graph/config 输入，不属于文件约定。
已移除的 `app`、`pages` 与顶层 `routes` 声明会被拒绝。

每个 `page.*` 锚点的相对目录是客户端 URL 的事实来源。`routing.mode` 为同一
文件树选择 SPA 或 MPA 物化。

## canonical Page 与 Route

Page 与客户端 Route 共用一个 positive anchor：

```text
<routing.dir>/**/page.{ts,tsx,js,jsx}
```

```ts
export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

```text
src/pages/
├── page.tsx                       # /
├── page.config.ts                # / 的可选构建期配置
├── home/
│   ├── page.tsx                   # /home
│   └── components/
│       ├── Hero.tsx
│       └── index.tsx          # 私有源码，不是另一个 Page
└── users/
    └── $userId/
        ├── page.tsx               # /users/:userId
        ├── index.ts
        ├── model.ts
        └── components/Profile.tsx
```

规则：

- 一个 route 目录只能有一个受支持扩展名的 `page.*`；
- 相对 `routing.dir` 的目录段决定 URL；
- 完整所在目录是 Page 私有 scope；
- 其他文件（包括 `index.*`）都是普通 Page 源码；
- 后代 `page.*` 会有意创建 nested Page 和 Route；
- 同一个 normalized URL shape 不能有两个 Page 锚点；
- Page entry 默认导出组件。

Page 私有代码不需要 `_`。Private 表示 ownership/discovery scope，不是安全边界。

发现由 positive anchor 驱动。`src/pages/home/components/index.tsx` 因为不叫
`page.*` 而保持私有；`src/pages/home/components/page.tsx` 则会有意创建
`/home/components`。

下划线不会创建私有 route segment。`_components/Card.tsx` 因为没有 Page
锚点而属于普通源码；`_private/page.tsx` 不会被静默忽略，而会产生 invalid
static segment diagnostic。Static URL segment 必须以字母或数字开头。

### Page 配置

canonical discovery 识别 anchored Page 同目录唯一可选的 `page.config.ts` 或
`page.config.js`，推荐 TypeScript 形式：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "首页",
  meta: {
    description: "应用首页。",
    keywords: "首页,evjs",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/feature": {
      enabled: true,
    },
  },
});
```

该 module 在构建期同步求值，default-export 只包含 static JSON data 的 plain
object。Core 持有 `title`、named `meta`、`render`、`hydrate`、`prerender`
与 `rsc`；插件注册并持有 `extensions` 下的 namespaced value。`meta` 只把
字符串 key/value 映射为 `<meta name="key" content="value">`，不提供
`property`、`charset`、link、script、动态元信息或通用 head DSL。Core
title/meta 会为 Page 物化；插件 extension value 在 runtime 使用前仍需插件显式
投影。

### Page HTML

应用默认使用顶层 `index.html`；`routing.html` 可选择另一份共享模板。在 MPA
mode 下，同一 Page 目录的 `index.html` 会覆盖该 Page 的 Document 模板。它
不会成为客户端 Page entry，SPA mode 也不会把它当作路由锚点。Page `title`
和 `meta` 会物化缺失 tag，并覆盖模板中匹配的 title 与 `meta[name]`；未声明值
保留模板 baseline。

## canonical 客户端路径

客户端路径来自 route 目录：

| 目录 segment | 含义 |
| --- | --- |
| `users` | 静态 segment。 |
| `$userId` | 动态 `:userId` segment。 |
| `$...splat` | 终止 catch-all。 |
| `(account)` | Pathless 组织分组。 |

```text
src/pages/
├── page.tsx                         # /
├── users/
│   ├── page.tsx                     # /users
│   └── $userId/
│       └── page.tsx                 # /users/:userId
├── files/
│   └── $...splat/
│       └── page.tsx                 # /files/*
└── (account)/
    └── settings/
        └── page.tsx                 # /settings
```

SPA 物化 Client Route；MPA 从相同 semantic Page/Route 出发物化 Page-owned
Document。MPA 只接受静态 Page path；`$param`、终止 `$...splat` 与 router-only
boundary facet 会显式失败，layout 在两种 mode 中都会组合。

## 服务端函数

Server function 没有约定根目录。构建从 Page、layout、wrapper 和 server code
沿 reachable import 发现。

一个 server-function module：

- 以 `"use server";` 开头；
- 导出命名 function declaration 或命名 `const` function expression；
- 不使用 default export；
- 不从其他模块 runtime re-export function。

```ts
"use server";

export async function getUser(userId: string) {
  return { id: userId };
}
```

在 Page 目录同位放置时，推荐 `.server.ts` 或 `.server.tsx`，便于人和工具识别
ownership。

## 服务端文件路由

默认从 `src/apis` 发现服务端请求路由。该文件系统约定与客户端 `page.*`
文件树有意分离。

```text
src/apis/
├── index.ts                    # /
├── api/
│   ├── health.ts              # /api/health
│   └── users/
│       ├── index.ts           # /api/users
│       └── $userId.ts         # /api/users/:userId
└── (internal)/
    └── metrics.ts             # /metrics
```

### 服务端路径段

| 文件段 | URL 含义 |
| --- | --- |
| `index` | 目录根。 |
| `$userId` | 动态参数。 |
| `(internal)` | Pathless 组织分组。 |
| 普通安全名称 | 静态 URL segment。 |

不支持 catch-all、optional、bracket 或 method-suffix 方言。
Static segment 必须以小写字母或数字开头。下划线前缀不是私有 route 约定：
没有 route export 的 helper 仍是普通源码，但带 `GET` export 的
`_private/health.ts` 会产生诊断。

### Route export

候选模块只有导出至少一个大写 HTTP method 才成为请求路由：

```ts
export function GET() {
  return Response.json({ ok: true });
}

export async function POST({ request }: { request: Request }) {
  const body = await request.json();
  return Response.json(body, { status: 201 });
}
```

只支持框架文档定义的大写 HTTP handler。Default export、小写 method name 和
route-module middleware export 无效。没有 route export 的文件保持为普通
colocated helper。

### 服务端路由冲突

构建会拒绝：

- 两个模块对应同一 URL；
- 同一动态 shape 使用两个参数名，如 `$id` 与 `$userId`；
- 不安全或格式错误的 group/dynamic segment；
- 生成 route id 冲突；
- route module 混入不支持的 route contract export。

不要添加 `route.ts` sentinel、`foo.get.ts`、bracket route、optional param、
catch-all 或 `server.entry`。

## Server Middleware

存在两种 middleware 约定：

```text
src/
├── middleware.ts
└── apis/
    ├── middleware.ts
    └── admin/
        ├── middleware.ts
        └── users.ts
```

- `src/middleware.ts` 全局包裹框架持有的 server 请求；
- `src/apis/**/middleware.ts` 按文件 scope 包裹后代 server file route。

Middleware file 不是 route，不能由 route module export middleware 代替。

## 生成文件

框架可能生成：

- `.ev/**` framework IR 和 entry facade；
- canonical SPA 文件路由在支持时生成的 `src/route-types.d.ts`；
- `dist/**` 构建产物。

不要编辑或 scaffold 任何生成文件，并保持 ignore。

## 迁移存量应用

canonical Page discovery 不要求用户选择 route reader 或 provider。新应用或迁移后
应用声明 `routing.mode`；仅存在 `src/pages` 目录不会产生客户端路由。

### Bigfish SPA

Migration normalizer 接受 `application.routes`，以及当前 Bigfish SPA route
tree 使用的 `component`、嵌套 `routes`、`layout`、`wrappers` 与 `redirect`
字段。它与当前 Umi config-route 行为一致，会拒绝 `children`。有限的 Bigfish
access/menu metadata 会保留在已注册的 `@evjs/bigfish-route` Route extension
中。共享 template 和 mount 值放在 `application.document` 下。它不接受
routing mode selector、顶层 `routes` 或顶层 `html`。canonical 目标把每个
component 移到公开 URL 对应目录并命名为 `page.*`。

### Smallfish

运行 Core 0.3 前，保留或调整每个公开 URL 目录，把其中的 `index.*` component
entry 重命名为 `page.*`，把 `config.json` 的 title 与受支持 named meta
映射到 core `title` 和 `meta`，其余插件持有值移入 namespaced
`page.config.ts` extension。删除 `config.json` 后，只选择
`routing.mode: "mpa"`。

### evjs 0.2

运行 Core 0.3 前，把每个已发布 filename route 移到 URL 对应目录并把 entry
重命名为 `page.*`；按需保留 `$param` 与 `(group)` 目录段。Core 0.3 不提供
source-reader 或 provider selector；源码树完成转换后，只声明 `routing.mode`。

canonical 迁移目标：

1. 把每个 Page entry 移到 URL 对应目录并命名为 `page.*`；
2. 把 title、受支持 named meta、rendering 与插件持有的 Page setting 移到
   `page.config.ts`；
3. Page helper 任意放在其目录，无需 `_`；
4. 参数使用 `$param`，终止 catch-all 使用 `$...splat`，pathless group 使用
   `(group)`；
5. 支持的 route facet 放在对应 route 目录；
6. 只声明 `routing.mode`，运行 `ev inspect` 审核 normalized Page、Route、
   Document、Page config 与 provenance。

Provider id 只可能出现在 raw CoreGraph/debug artifact 中解释 provenance；普通
inspect routing 输出会隐藏它。它不定义另一种公开路由模型。
