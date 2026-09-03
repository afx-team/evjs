# 项目结构

本页完整列出 evjs 的应用文件约定，并说明未被框架自动发现的源码应该如何组织。

## 推荐结构

```text
my-evjs-app/
├── ev.config.ts                     # 应用级框架选择
├── index.html                       # 共享 HTML 模板
├── package.json
├── public/                          # 复制到产物的静态文件
└── src/
    ├── pages/
    │   ├── page.tsx                 # /
    │   ├── page.config.ts           # / 的元信息与渲染
    │   ├── layout.tsx               # 根布局
    │   ├── about/
    │   │   └── page.tsx             # /about
    │   └── users/
    │       ├── page.tsx             # /users
    │       ├── components/          # /users 拥有的代码
    │       └── $userId/
    │           ├── page.tsx         # /users/:userId
    │           └── get-user.server.ts
    ├── apis/
    │   ├── middleware.ts            # 所有 API 路由的中间件
    │   └── health/
    │       └── api.ts               # /health
    ├── middlewares/
    │   ├── middleware.ts            # 有序全局中间件
    │   └── authentication.ts
    ├── components/                  # 共享 UI
    ├── features/                    # 共享业务功能
    ├── hooks/
    └── lib/
```

受识别约定之外的目录只是建议，不是框架要求。请使用符合产品和团队的组织方式。

## 目录职责

`page.*` 或 `api.*` 文件会让所在目录成为公共入口：

- `page.*` 发布页面和客户端路由；
- `api.*` 发布服务端请求路由。

除非匹配其他文件约定，否则目录中的其余文件都是普通源码。因此可以把组件、Hook 函数、
模型、测试、样式、资源和服务端函数放在使用它们的页面旁边。

```text
src/pages/orders/$orderId/
├── page.tsx                         # 页面与路由
├── page.config.ts                  # 静态页面选择
├── index.ts                        # 普通私有模块
├── model.ts
├── get-order.server.ts
├── components/
│   └── Summary.tsx
└── __tests__/
    └── page.test.tsx
```

后代目录包含自己的 `page.*` 时会创建另一个页面。普通代码不需要 `_` 前缀。这里的“私有”只表示不会被发现为路由，不代表访问控制。

## 约定矩阵

除特别说明外，路径都相对于项目根目录。

| 路径或声明 | 含义 | 重要规则 |
| --- | --- | --- |
| `ev.config.ts` | 应用配置 | 从 `@evjs/ev` 导入 `defineConfig`。 |
| `conventions: false` | 一起关闭页面、API 路由和中间件发现 | 仅用于自行管理路由与运行时的应用；不能与 `routing` 组合。 |
| `routing.mode` | 启用文件页面发现并选择 `"spa"` 或 `"mpa"` | 页面根目录始终为 `src/pages`。 |
| `src/pages/**/page.{ts,tsx,js,jsx}` | 页面和客户端路由 | 每个路由目录只能有一种扩展名，默认导出 React 组件。 |
| `<页面>/page.config.{ts,js}` | 可选静态页面配置 | 只放在 `page.*` 文件旁，每页一种变体；推荐 TypeScript 与 `definePageConfig()`。 |
| `src/pages/**/$param/` | 动态路由段 | 生成 `:param`，仅 SPA。 |
| `src/pages/**/$...splat/` | 通配路由段 | 必须终止，仅 SPA。 |
| `src/pages/**/(group)/` | 无路径分组 | 组织源码但不改变 URL。 |
| `src/pages/**/layout.*` | 后代页面布局 | 在 SPA 与 MPA 中组合。 |
| `src/pages/**/error.*`、`not-found.*` | 路由错误与未找到边界 | 仅 SPA。 |
| 页面目录中的其他文件 | 页面拥有的源码 | 包括 `index.*` 在内都不会创建路由。 |
| `<页面>/index.html` | 单个 MPA 页面的 HTML 模板 | 不创建页面或客户端入口。 |
| `index.html` 或 `routing.html` | 共享应用 HTML 模板 | 默认使用 `index.html`。 |
| 以 `"use server";` 开头且被应用导入的模块 | 服务端函数模块 | 只能命名导出可调用值，不要求固定目录。 |
| `src/apis/**/api.{ts,tsx,js,jsx}` | 公共 HTTP 路由 | 每个目录一种变体，导出大写 HTTP 方法处理器。 |
| API 路由目录中的其他文件 | 路由拥有的源码 | 辅助文件和 `index.*` 不创建端点。 |
| `src/middlewares/middleware.*` | 全局中间件组合 | 默认导出一个中间件或显式排序的非空列表。 |
| `src/middlewares` 中的其他文件 | 中间件实现模块 | 显式导入，文件名不决定顺序。 |
| `src/apis/**/middleware.*` | 路由子树范围中间件 | 默认导出一个中间件，本身不是路由。 |
| `public/**` | 静态文件 | 按输出配置复制到浏览器产物。 |
| `.ev/**`、`dist/**`、`src/route-types.d.ts`、`src/plugin-types.d.ts` | 生成产物 | 忽略，不要编辑或复制进脚手架。 |

### 页面配置

把静态行为放在页面旁：

```ts title="src/pages/orders/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Orders",
  meta: {
    description: "Review and manage customer orders.",
  },
  render: "csr",
  plugins: {
    analytics: {
      channel: "orders",
    },
  },
});
```

核心字段包括 `title`、`meta`、`render`、`hydrate`、`prerender`、`rsc` 和静态 `document` 选项。`plugins` 保存已安装且支持页面配置的插件值。默认导出必须是静态 JSON 数据。

`meta` 只创建 `<meta name="..." content="...">`，不是通用 Head 元素 API。渲染组合见[渲染](./rendering)。

拥有静态 HTML 的页面可以通过 `document.aliases` 增加经过校验的 `.html` 或 `.htm` 输出别名。别名只在另一个文件路径发布同一份文档，不创建新页面或路由。

### 客户端路径段

目录嵌套就是路由嵌套：

```text
src/pages/
├── page.tsx                         # /
├── teams/
│   ├── page.tsx                     # /teams
│   └── $teamId/
│       └── page.tsx                 # /teams/:teamId
├── files/
│   └── $...splat/
│       └── page.tsx                 # /files/*
└── (marketing)/
    └── about/
        └── page.tsx                 # /about
```

没有 `page.*` 的目录可以组织后代。静态 URL 段必须以字母或数字开头。evjs 会拒绝格式错误的段、重复路径、模糊动态形态和非终止通配段。

### 服务端路由路径

API 路由也由 `src/apis` 下的目录决定 URL 和相关代码位置：

```text
src/apis/
├── health/
│   └── api.ts                       # /health
├── users/
│   ├── api.ts                       # /users
│   ├── schema.ts                    # 路由拥有的辅助文件
│   └── $userId/
│       └── api.ts                   # /users/:userId
└── (internal)/
    └── metrics/
        └── api.ts                   # /metrics
```

服务端路由路径支持静态、`$param` 和 `(group)` 段，不支持通配、可选与方括号语法。页面路由和 API 路由共享请求路径空间，因此冲突形态会校验失败。

### 中间件顺序

在 `src/middlewares/middleware.ts` 中显式声明全局顺序：

```ts title="src/middlewares/middleware.ts"
import type { MiddlewareChain } from "@evjs/ev/server-context";
import authentication from "./authentication";
import tracing from "./tracing";

export default [tracing, authentication] satisfies MiddlewareChain;
```

请求从左到右进入，`await next()` 之后的工作从右到左退出。
`src/apis/**/middleware.*` 包裹同目录及其后代 API 路由。

## SPA 与 MPA 结构

两种模式读取同一棵页面树：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" }, // 或 "mpa"
});
```

- SPA 支持动态段、通配路径、布局、边界和客户端导航；可选的
  `routing.basepath` 会为部署后的浏览器路径统一添加前缀，不改变页面树或源码路由路径。
- MPA 只使用静态页面路径，并为每个页面创建独立 HTML 文档；布局仍会组合到页面外层。

编写方式见[页面与路由](./client-routes)，交付选择见[渲染](./rendering)。

## 共享代码与共置代码

根据代码的使用范围，而不是文件类型，决定放置位置：

| 代码 | 建议位置 |
| --- | --- |
| 只被一个页面或路由使用 | 放在该页面或 API 路由目录内 |
| 被同一功能的多个页面共享 | `src/features/<feature>` |
| 共享视觉基础组件 | `src/components` |
| 跨功能工具或基础设施 | `src/lib` |
| 公共静态文件 | `public` |

这样既让页面目录保持可理解，也避免 `src/pages` 只剩下一批薄入口文件。

## 使用显式路由树

大多数应用应使用 `routing.mode` 和上面的文件约定。需要自行维护程序化 SPA 路由树的项目可以使用 `application.routes`。它不能与 `routing` 组合，也不支持 MPA。

选择这种模型前，请阅读[自定义路由与运行时](./advanced-conventions)。
