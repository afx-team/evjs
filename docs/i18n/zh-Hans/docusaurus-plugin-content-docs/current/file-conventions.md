# 文件约定

evjs 的文件约定保持少而明确。Positive `page.*` 锚点定义客户端 Page 及其
file route，positive `api.*` 锚点定义 server request Route。两棵树都由锚点的
完整所在目录持有 scope 并决定 URL。

完整矩阵参见[项目结构](./project-structure)。

## 约定根目录

| 根 | 用途 |
| --- | --- |
| `src/pages` | canonical Page-and-Route 文件树。 |
| `src/apis` | 固定的 Server request `api.*` 锚点树。 |
| `src/middlewares/middleware.*` | 显式排序的全局框架 server middleware 组合锚点。 |
| `src/apis/**/middleware.ts` | 作用于同目录及后代 server file route 的 middleware。 |
| reachable 源码模块 | 以 `"use server";` 开头的 server function。 |

Page 锚点、server request-route 锚点与两类 middleware root 共同组成一个框架持有的
发现单元。顶层 `conventions: false` 会整体关闭这个单元，框架不提供逐 root
开关；该配置不能与显式客户端 `routing` 声明一起使用。文件约定保持启用时，
客户端 Page 根目录固定为 `src/pages`，server Route 根目录固定为 `src/apis`。

reachable 的 `"use server";` 模块、仅支持 SPA 的 `application.routes` 显式
route-tree 配置，以及插件 contribution 是 graph/config 输入，不属于文件约定。

每个 `page.*` 锚点的相对目录是客户端 URL 的事实来源。`routing.mode` 为同一
文件树选择 SPA 或 MPA 物化。

## 全局样式

全局样式是普通源码 module，没有特殊的文件名或目录约定。请在根 layout、
Application layout、Page 或共享组件中显式导入：

```ts
import "./global.css";
```

Less 变量与 mixin 也遵循同样规则。每个使用它们的 Less module 都需要显式导入：

```less
@import "./tokens.less";
```

## canonical Page 与 Route

Page 与客户端 Route 共用一个 positive anchor：

```text
src/pages/**/page.{ts,tsx,js,jsx}
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
- 相对 `src/pages` 的目录段决定 URL；
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
  plugins: {
    analytics: {
      channel: "home",
    },
  },
});
```

该 module 在构建期同步求值，default-export 只包含 static JSON data 的 plain
object。Core 持有 `title`、named `meta`、`render`、`hydrate`、`prerender`
与 `rsc`；已安装且支持 Page 配置的插件使用 `plugins` 下各自的 canonical id。省略
`render` 始终表示 CSR，且必须省略 `hydrate`；显式 SSR/SSG Page 可以选择
`"load"` 或 `"none"`。`meta` 只把
字符串 key/value 映射为 `<meta name="key" content="value">`，不提供
`property`、`charset`、link、script、动态元信息或通用 head DSL。Core
title/meta 会为 Page 物化；Page 插件值在 runtime 使用前仍需插件显式投影。

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

Server request Route 从固定 `src/apis` 根目录下的 positive `api.*` 锚点发现。
该文件系统约定与客户端 `page.*` 树彼此独立，但采用相同的目录持有模型。

```text
src/apis/
├── api.ts                      # /
├── api/
│   ├── health/
│   │   └── api.ts             # /api/health
│   └── users/
│       ├── api.ts             # /api/users
│       ├── schema.ts          # 私有源码
│       └── $userId/
│           └── api.ts         # /api/users/:userId
└── (internal)/
    └── metrics/
        └── api.ts             # /metrics
```

### 服务端路径段

| 目录 segment | URL 含义 |
| --- | --- |
| `$userId` | 动态参数。 |
| `(internal)` | Pathless 组织分组。 |
| 普通安全名称 | 静态 URL segment。 |

`api.*` basename 不增加 URL segment。不支持 catch-all、optional 或 bracket
目录方言。Static 目录 segment 必须以小写字母或数字开头；只有无效目录树中存在
`api.*` 锚点或 route middleware 时才会产生诊断。

### Route export

只有 `src/apis/**/api.{ts,tsx,js,jsx}` 才是 route candidate，每个
route 目录只允许一个源码扩展名变体。锚点至少导出一个大写 HTTP method：

```ts
export function GET() {
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(body, { status: 201 });
}
```

只支持框架文档定义的大写 HTTP handler。Handler 可以在本地声明，也可以从 route
私有 module import、re-export 或由 factory 创建。Discovery 会拒绝静态已知为
non-callable 的值；生成的 `createRoute()` definition 会在 server 启动前校验每个
求值后的 handler。Generator、default export、小写 method name、helper export 与
route-module middleware export 都无效。其他任何 basename 都是普通 route 私有源码，
无论导出什么都不会发布 Route。

### 服务端路由冲突

构建会拒绝：

- 两个锚点对应同一 normalized URL；
- 同一 route 目录存在多个 `api.*` 源码扩展名变体；
- 同一动态 shape 使用两个参数名，如 `$id` 与 `$userId`；
- 不安全或格式错误的 group/dynamic segment；
- 生成 route id 冲突；
- route module 混入不支持的 route contract export；
- server request Route pattern 与占用 URL 的 Page/redirect pattern 或 active
  framework runtime endpoint 相交。

冲突检查会按恰好一次 URL decode 后比较 static route alias。例如，`/%75sers` 与
`/users` 占用同一个 request path，而双重编码文本仍保持不同。

`index.ts`、`route.ts` 与 `foo.get.ts` 都不是备选 route anchor。

## Server Middleware

存在两种 middleware 约定：

```text
src/
├── middlewares/
│   ├── middleware.ts
│   ├── tracing.ts
│   └── authentication.ts
└── apis/
    ├── middleware.ts
    └── admin/
        ├── middleware.ts
        ├── api.ts
        └── users/
            └── api.ts
```

- `src/middlewares/middleware.*` 默认导出一个全局 middleware，或显式排序的
  非空列表；TypeScript 列表应使用 `satisfies MiddlewareChain`；
- `src/middlewares` 下的其他文件都是由组合锚点导入的普通模块，不会按文件名
  排序；
- `src/apis/**/middleware.ts` 按文件 scope 包裹同目录及后代 server file
  route，并默认导出一个 middleware。

Middleware file 不是 route，不能由 route module export middleware 代替。

## 生成文件

框架可能生成：

- `.ev/**` framework IR 和 entry facade；
- canonical SPA 文件路由在支持时生成的 `src/route-types.d.ts`；
- `src/plugin-types.d.ts`，用于稳定桥接项目的 `ev.config.ts` 类型；
- `dist/**` 构建产物。

不要编辑或 scaffold 任何生成文件，并保持 ignore。

## 路由输入边界

canonical Page discovery 不要求用户选择 route reader 或 provider。应用声明
`routing.mode` 后，只有 `page.*` positive anchor 会产生客户端路由；仅存在
`src/pages` 目录不会发布 Page。

### 显式 SPA route tree

`application` 不能与 `routing` 同时声明。显式 route-tree normalizer 接受
`application.routes` 中的 `page` 或 `component`、
嵌套 `routes`、`layout`、`wrappers` 与 `redirect` 字段。
`application.pageRoot` 只控制该显式输入的 reference 解析，不会改变固定的
`src/pages` 文件约定根目录；`children` 会被拒绝。`exact: true` 只作为
terminal-match 断言；`exact: false` 与 exact Route 下的嵌套路由都会被拒绝。
插件配置由 Page 持有；显式 Route 与 Document 对象不提供插件配置 bag。共享
template 和 mount 值放在 `application.document` 下。该配置只能物化 SPA。`page`
reference
必须解析到唯一 canonical `page.*` 锚点。显式 component 以 `index.*` 或
`page.*` 结尾时持有所在目录；其他 basename 只持有模块本身，不消费相邻
`page.config.ts`。

### Canonical Page tree

`routing.mode` 只发现 `page.*` 锚点。每个 Page entry 位于其 URL 对应目录，Page
设置放在相邻 `page.config.ts`。Page-private helper 可以使用包括 `index.*` 在内的
其他 basename，而不会创建 route。参数、终止 catch-all 与 pathless group 分别
使用 `$param`、`$...splat` 与 `(group)` 目录。运行 `ev inspect` 可审核 normalized
Page、Route、Document、Page config 与 diagnostic。
