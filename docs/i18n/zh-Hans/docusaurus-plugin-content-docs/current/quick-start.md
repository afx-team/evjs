# 快速开始

## 创建新项目

```bash
npx @evjs/create-app my-app
cd my-app && npm install
```

两个参数都是可选的 —— 省略时 CLI 会交互式提示。

### 可用模板

| 模板 | 描述 |
|------|------|
| `basic` | 路由 + 服务端函数 |
| `mpa` | 多页面应用模板 |
| `api-routes` | 通过默认服务端文件路由构建 REST API |
| `complex-routing` | 参数、搜索、根布局、加载器、嵌套路径 |
| `with-tailwind` | 通过 PostCSS 使用 Tailwind CSS |
| `with-trpc` | tRPC 互操作示例 |
| `with-sqlite` | 基于 SQLite 的全栈 CRUD |
| `custom-ws-transport` | 自定义 WebSocket 传输层 |
| `plugin-authoring` | 插件生命周期与构建器钩子示例 |

## 开发

```bash
ev dev
```

开发服务器运行在 `http://localhost:3000`，支持热模块替换。app、page、server
file-route 和 server middleware convention import graph 中可达的 `"use server"` 模块会被自动发现。

## 生产构建

```bash
ev build
```

## 项目结构

```
my-app/
├── .gitignore              # 忽略 evjs 生成类型文件
├── index.html              # HTML 模板（必须包含 <div id="app">）
├── ev.config.ts            # 可选配置
├── src/
│   ├── layout/
│   │   └── index.tsx       # 可选 SPA 根布局
│   ├── pages/              # 文件路由
│   │   ├── index.tsx       # /
│   │   └── users/$id.tsx   # /users/$id
│   ├── apis/               # 服务端文件路由
│   │   ├── users.server.ts # "use server" 函数
│   │   └── api/
│   │       └── health.ts   # /api/health
│   └── middleware.ts       # 全局服务端中间件
├── package.json
└── tsconfig.json
```

## 页面

```tsx
// src/pages/users/$id.tsx
import { usePageParams } from "@evjs/ev/route";
import { useQuery } from "@evjs/ev/query";
import { getUser } from "../../apis/users.server";

export default function UserPage() {
  const { id } = usePageParams();
  const { data } = useQuery(getUser, id);
  return <main>{data?.name}</main>;
}
```

当项目存在 `src/pages`，且项目没有声明显式的 `app` 或 `pages`
配置时，evjs 会自动基于文件树构建一个 SPA。用户不需要创建
路由胶水；这些内容由框架生成和托管。SPA 模式只会为 TypeScript 写入
`src/route-types.d.ts`，脚手架应用默认忽略它。

SPA 根布局发现是可选的。默认路由目录旁边使用 `src/layout/index.tsx`；当应用 shell
明确放在其他位置时，也可以通过 `routing.conventions.layout` 指向其他模块。嵌套
SPA route layout 可以放在某个路由段下，例如 `src/pages/posts/layout.tsx`。

## MPA 模式

MPA 使用同一套 `src/pages` 文件，只需要切换 routing 模式：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

每个页面都会生成独立 HTML 文档和客户端 entry，不引入客户端路由器配置。
框架 layout 约定只用于 SPA；MPA 页面需要公共外框时，应像普通 React 代码一样组合共享组件，
且不支持 `routing.conventions.layout`。

## 包列表

| 包 | 用途 |
|---|------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | 框架 API、配置、插件、构建编排、deployment helpers 和 file-convention authoring subpaths |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | 注入默认构建器的轻量 CLI 包装 (`ev dev`, `ev build`, `ev inspect`) |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | 项目脚手架 (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | 不使用 evjs file conventions 时的 standalone/manual 浏览器运行时 core |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | 手写 Hono/fetch app 和 route primitives 的 standalone/manual 服务端运行时 core |

Manifest schema、build tools、生成 page runtime 和 shell 内部实现都位于上述公开包中。
应用的 config/build 代码从 `@evjs/ev` 导入框架组合 API。file-convention 应用源码从
`@evjs/ev/route` 导入 route data helpers，从 `@evjs/ev/navigation` 导入导航 helpers，
从 `@evjs/ev/query` 导入 server-function query helpers，从 `@evjs/ev/server-context` 导入 request helpers，
从 `@evjs/ev/transport` 导入自定义 server-function transport helpers。自己持有构建
管线的浏览器-only CSR 应用可以只使用 `@evjs/client`，不依赖 `@evjs/ev`。
`@evjs/ev/*` subpaths 围绕 evjs file-convention authoring 语义整理，不是
`@evjs/client` 或 `@evjs/server` 的镜像 re-export；后两者是更底层的
standalone/manual runtime packages。
`@evjs/cli` 和 `@evjs/create-app` 应作为工具使用，不应被应用模块 import。
`@evjs/bundler-utoopack` 这类 bundler adapter 以及 `@evjs/shared` 这类共享契约模块，
只面向自定义框架工具或 adapter 开发。

生成的 framework 代码通过 `@evjs/ev/_internal/*` 解析 client/server runtime
internals，因此普通 file-convention 应用不再直接安装 `@evjs/client` 或
`@evjs/server`。

## 必需依赖

```json
{
  "dependencies": {
    "@evjs/ev": "<same version>",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/cli": "<same version>",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^6.0.2"
  }
}
```

:::important

应用中的所有 `@evjs/*` 包必须保持相同版本。只有应用源码直接导入
standalone/manual runtime surface 时才需要显式声明 runtime packages。脚手架
file-convention 模板包含 `@evjs/ev` 与 `@evjs/cli`；`@evjs/client` 和
`@evjs/server` 是 `@evjs/ev` 为生成代码携带的 runtime dependencies。如果额外添加
adapter 包，升级时也要和其他框架包一起升级。

:::

## 重要规则

- 配置文件：`ev.config.ts`（不是 `evjs.config.ts`）
- 从 `@evjs/ev` 导入 `defineConfig`
- HTML 必须包含 `<div id="app">` 作为渲染目标
- 不要在你的**项目** `package.json` 中添加 `"type": "module"` —— 服务端 bundle 使用 CJS 格式
- 优先使用 `src/pages` 作为路由事实来源
- 保持 `src/route-types.d.ts` 为生成且被忽略的文件；不要在应用代码里导入它
- 独立页面且不需要客户端路由器时，使用 `routing.mode: "mpa"`
