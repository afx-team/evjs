# 文件约定

evjs 只使用少量明确的文件标记。`page.*` 文件创建页面和客户端路由，`api.*` 文件
创建 API 路由。两类文件都由所在目录决定 URL，并在同一目录组织相关源码。

完整矩阵参见[项目结构](./project-structure)。

## 约定根目录

| 根 | 用途 |
| --- | --- |
| `src/pages` | 文件页面与客户端路由。 |
| `src/apis` | 文件式 API 路由。 |
| `src/middlewares/middleware.*` | 显式排列全局中间件的入口。 |
| 被应用引用的源码模块 | 以 `"use server";` 开头的服务端函数模块。 |

页面文件、API 路由文件和全局中间件入口会一起启用或关闭。顶层
`conventions: false` 会关闭全部文件发现，不能分别控制，也不能与 `routing` 同时
配置。启用约定时，页面固定放在 `src/pages`，API 路由固定放在 `src/apis`。

被应用引用的 `"use server";` 模块、仅支持 SPA 的 `application.routes`，以及插件
生成的模块不受这个开关控制。

每个 `page.*` 文件的相对目录决定客户端 URL。`routing.mode` 会把同一棵页面树
构建为 SPA 或 MPA。

## 全局样式

全局样式是普通源码模块，没有特殊的文件名或目录约定。请在根布局、页面或共享组件中
显式导入：

```ts
import "./global.css";
```

Less 变量与 mixin 也遵循同样规则。每个使用它们的 Less 模块都需要显式导入：

```less
@import "./tokens.less";
```

## 页面与客户端路由

页面和客户端路由共用一个文件标记：

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
│       └── index.tsx          # 私有源码，不是另一个页面
└── users/
    └── $userId/
        ├── page.tsx               # /users/:userId
        ├── index.ts
        ├── model.ts
        └── components/Profile.tsx
```

规则：

- 一个路由目录只能有一个受支持扩展名的 `page.*`；
- 相对 `src/pages` 的目录段决定 URL；
- 所在目录集中组织该页面使用的源码；
- 其他文件（包括 `index.*`）都是普通页面源码；
- 后代目录中的 `page.*` 会创建嵌套页面与路由；
- 同一种 URL 形态不能由两个页面文件重复声明；
- 页面入口默认导出组件。

页面专属代码不需要 `_` 前缀。这里的“私有”只表示不会被发现为另一个路由，不代表安全边界。

框架根据明确的文件名发现页面。`src/pages/home/components/index.tsx` 因为不叫
`page.*` 而保持为普通源码；`src/pages/home/components/page.tsx` 则会创建
`/home/components`。

下划线不会创建私有路径段。`_components/Card.tsx` 因为不是页面文件而属于普通源码；
`_private/page.tsx` 不会被静默忽略，而会报告无效静态路径段。静态 URL 段必须以字母
或数字开头。

### 页面配置

页面目录可以包含一个可选的 `page.config.ts` 或 `page.config.js`，推荐使用
TypeScript：

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

该模块在构建时同步求值，默认导出只包含静态 JSON 数据的普通对象。框架字段包括
`title`、命名 `meta`、`render`、`hydrate`、`prerender` 与 `rsc`；支持页面配置的
插件使用 `plugins` 下各自的 id。省略 `render` 始终表示 CSR，且必须省略
`hydrate`；显式 SSR/SSG 页面可以选择
`"load"` 或 `"none"`。`meta` 只把
字符串键值映射为 `<meta name="key" content="value">`，不提供 `property`、
`charset`、`link`、`script`、动态元信息或通用 Head API。框架会把 `title` 和 `meta` 应用到
页面；插件则自行决定页面配置如何影响运行时代码。

### 页面 HTML

应用默认使用顶层 `index.html`；`routing.html` 可选择另一份共享模板。在 MPA 模式
下，页面目录中的 `index.html` 会覆盖该页面的 HTML 模板。它不会成为客户端页面入口，
SPA 也不会把它当作路由文件。页面的 `title` 和 `meta` 会补充缺失标签，并覆盖模板中
匹配的标题与 `meta[name]`；未声明的值继续使用模板默认值。

## 客户端路径段

客户端路径来自页面目录：

| 目录段 | 含义 |
| --- | --- |
| `users` | 静态路径段。 |
| `$userId` | 动态 `:userId` 路径段。 |
| `$...splat` | 末尾通配路径。 |
| `(account)` | 不影响 URL 的组织分组。 |

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

SPA 会构建浏览器路由树；MPA 则从相同页面创建各个静态路径的 HTML 文档。MPA 会拒绝
`$param`、末尾 `$...splat` 和仅适用于浏览器路由器的边界；布局在两种模式中都有效。

## 服务端函数

服务端函数没有固定目录。构建会沿页面、布局、包装组件和服务端代码的导入关系发现它们。

服务端函数模块需要：

- 以 `"use server";` 开头；
- 导出命名函数声明，或赋值为函数的命名 `const`；
- 不使用默认导出；
- 不从其他模块重新导出运行时函数。

```ts
"use server";

export async function getUser(userId: string) {
  return { id: userId };
}
```

在页面目录中就近放置时，推荐使用 `.server.ts` 或 `.server.tsx`，便于开发者和工具
识别服务端边界。

## API 路由

框架从固定的 `src/apis` 根目录中发现 `api.*` 文件并创建 API 路由。该约定与客户端
`page.*` 文件树彼此独立，但同样由目录决定 URL。

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

| 目录段 | URL 含义 |
| --- | --- |
| `$userId` | 动态参数。 |
| `(internal)` | 不影响 URL 的组织分组。 |
| 普通安全名称 | 静态 URL 段。 |

`api.*` 文件名不增加 URL 段。不支持通配、可选或方括号形式的目录语法。静态目录段
必须以小写字母或数字开头；只有目录树中存在 `api.*` 时，框架才会检查并
报告无效路径段。

### 路由处理器导出

只有 `src/apis/**/api.{ts,tsx,js,jsx}` 才会创建路由，每个路由目录只允许一种源码
扩展名。文件至少导出一个大写 HTTP 方法：

```ts
export function GET() {
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(body, { status: 201 });
}
```

只支持文档列出的大写 HTTP 方法处理器。处理器可以在本地声明，也可以从同一路由目录的
模块导入、重新导出或由工厂函数创建。框架会拒绝明确不可调用的值，并在服务端启动前校验
处理器。生成器、默认导出、小写方法名、辅助函数导出和路由模块中的中间件导出都无效。
其他文件名都属于普通路由源码，无论导出什么都不会创建端点。

### 服务端路由冲突

构建会拒绝：

- 两个文件对应同一规范化 URL；
- 同一路由目录存在多个 `api.*` 源码扩展名；
- 同一种动态路径使用两个参数名，如 `$id` 与 `$userId`；
- 分组或动态路径段不安全、格式错误；
- 生成的路由 id 冲突；
- 路由模块混入不支持的导出；
- API 路由与页面、重定向或已启用的框架运行时端点发生路径冲突。

冲突检查会在进行一次 URL 解码后比较静态路由别名。例如，`/%75sers` 与 `/users`
占用同一个请求路径，而双重编码文本仍保持不同。

`index.ts`、`route.ts` 与 `foo.get.ts` 都不会创建路由。

## 服务端中间件

全局中间件通过一个组合入口声明：

```text
src/middlewares/
├── middleware.ts
├── tracing.ts
└── authentication.ts
```

- `src/middlewares/middleware.*` 默认导出一个全局中间件，或显式排序的
  非空列表；TypeScript 列表应使用 `satisfies MiddlewareChain`；
- `src/middlewares` 下的其他文件都是由 `middleware.*` 显式导入的普通模块，不会按文件名
  排序。

入口允许 `.ts`、`.tsx`、`.js` 或 `.jsx`，`src/middlewares` 中只能有一种变体。
数组必须扁平，复用链时使用展开语法；禁止显式空数组导出、数组空槽、非函数、生成器和
运行时命名导出。动态计算的全局链可以在禁用时返回 `[]`。

`api.*` 只导出大写 HTTP 方法。使用 `@evjs/ev/api` 的
`withMiddlewares(handler, middlewares)` 组合各方法的策略，从普通模块导入共享链。
自动 HEAD 使用 GET 的链；自动 OPTIONS 和 405 响应执行全局中间件。
详见[API 路由与中间件](./server-routes)。

## 生成文件

框架可能生成：

- `.ev/**` 框架中间产物和生成入口；
- SPA 文件路由在支持时生成的 `src/route-types.d.ts`；
- `src/plugin-types.d.ts`，用于稳定桥接项目的 `ev.config.ts` 类型；
- `dist/**` 构建产物。

不要编辑这些生成文件，也不要把它们复制进脚手架；请始终保持忽略。

## 其他路由配置方式

文件式路由不要求用户选择额外的路由读取器或 Provider。应用声明 `routing.mode` 后，
只有 `page.*` 文件会创建客户端路由；仅存在 `src/pages` 目录不会创建页面。

### 显式 SPA 路由树

`application` 不能与 `routing` 同时声明。显式路由配置接受
`application.routes` 中的 `page` 或 `component`、
嵌套 `routes`、`layout`、`wrappers` 与 `redirect` 字段。
`application.pageRoot` 只控制该配置中的引用解析，不会改变固定的
`src/pages` 文件约定根目录；`children` 会被拒绝。`exact: true` 只用于断言终止匹配；
`exact: false` 与精确路由下的嵌套路由都会被拒绝。插件配置仍属于页面；显式路由和文档
对象不提供插件配置。共享模板与挂载节点放在 `application.document` 下。该配置只支持
SPA。`page` 引用必须解析到唯一的 `page.*` 文件。显式 `component` 以 `index.*` 或
`page.*` 结尾时使用所在目录；其他文件名只代表模块本身，不读取相邻
`page.config.ts`。

### 文件页面树

`routing.mode` 只发现 `page.*` 文件。每个页面入口位于其 URL 对应目录，页面设置放在
相邻 `page.config.ts`。页面专属辅助模块可以使用包括 `index.*` 在内的其他文件名，而
不会创建路由。参数、末尾通配与无路径分组分别使用 `$param`、`$...splat` 与 `(group)`
目录。运行 `ev inspect` 可以查看最终页面、路由、文档、页面配置和诊断结果。
