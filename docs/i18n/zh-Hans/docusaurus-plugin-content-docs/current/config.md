# 配置

evjs Core 0.3 为 SPA 和 MPA 提供同一种应用创作模型：

- `src/pages/**/page.*` 是 canonical Page 与客户端路由锚点；
- Page 所在目录同时决定其 scope 与 URL；
- `routing.mode` 只选择 SPA 或 MPA 物化方式，不改变语义 Page/Route 树。

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

其余信息来自文件树：

```text
src/pages/
├── page.tsx                         # /
├── users/
│   ├── page.tsx                     # /users
│   └── $userId/
│       └── page.tsx                 # /users/:userId
└── (account)/
    └── settings/
        └── page.tsx                 # /settings
```

## 文件约定发现

文件约定默认启用。完全自行持有 runtime composition 的应用，可以用唯一的顶层
开关关闭文件系统发现：

```ts
export default defineConfig({
  conventions: false,
});
```

该配置会关闭 `src/pages` 下的 `page.*` 发现、`src/apis` 下的 `api.*` server
request-route 发现，以及全局与 route-scoped middleware 文件发现。它不能和显式
`routing` 或 `server.routing` 声明一起配置。框架不提供粒度更细的约定关闭
开关。

仅支持 SPA 的 `application.routes` 显式 route-tree 配置不依赖文件约定。reachable
且带 `"use server";` 的模块，以及插件 contribution 生成的模块也不依赖文件约定。
`app`、`pages` 与顶层 `routes` 不属于公共配置，会被拒绝。

## Routing

`routing` 启用 canonical 客户端 Page-and-Route 约定。

| 字段 | 含义 |
| --- | --- |
| `mode` | `"spa"` 或 `"mpa"`，只改变物化方式。 |
| `html` | 共享 HTML 模板，默认 `./index.html`。 |
| `mount` | 共享挂载选择器，默认 `#app`。 |

Canonical Page discovery 始终读取 `src/pages`；`routing` 不提供客户端根目录
覆盖项。

请显式声明 mode，避免框架把一个与路由无关的 `src/pages` 目录误识别为
Page 路由树：

```ts
export default defineConfig({
  routing: { mode: "spa" },
});
```

## Page 与路径规则

每个路由目录可以包含且只能包含一个 `page.ts`、`page.tsx`、`page.js` 或
`page.jsx`。Page 模块默认导出组件，该目录也是 Page 的私有 ownership scope。

| 目录段 | 语义路由段 |
| --- | --- |
| `users` | 静态 `users`。 |
| `$userId` | 动态 `:userId`。 |
| `$...splat` | 终止 catch-all。 |
| `(account)` | 无路径分组。 |

构建会拒绝非法 segment、同一目录下的多个 Page 扩展名变体、重复的归一化
路径、动态参数形状歧义和生成路由 id 冲突。`index.*` 没有 canonical
客户端路由语义，可以作为普通私有模块使用。

### 带子路由的 Page

目录嵌套创建子路由。在 SPA mode 下，父 Page 可以渲染嵌套路由 outlet：

```tsx
import { Outlet } from "@evjs/ev/navigation";

export default function UsersPage() {
  return (
    <main>
      <h1>Users</h1>
      <Outlet />
    </main>
  );
}
```

没有 `page.*` 的目录可以只组织后代路由；`(group)` 目录还会省略自己的 URL
segment。

## SPA 与 MPA

同一棵文件树根据 `routing.mode` 改变物化结果。

| 模型对象 | SPA | MPA |
| --- | --- | --- |
| Page | `page.*` 及所在目录 scope | 相同的 Page 与 scope |
| Route | 同一浏览器路由树中的 Client Route | 相同的语义 Route，用来选择独立 Page entry |
| Document | Application-owned shell，外加静态 SSG Page 的 Page-owned Document | 每条静态 Page route 一个 Page-owned HTML Document |
| 源路径 | 相对 `src/pages` 的路由目录 | 相同的源路径 |

### SPA

```ts
export default defineConfig({
  routing: { mode: "spa" },
});
```

SPA 支持嵌套路由、动态参数、splat 和文件约定的 layout/boundary。

### MPA

```ts
export default defineConfig({
  routing: { mode: "mpa" },
});
```

MPA discovery 接受相同的 `page.*` 锚点，并生成相同的语义 Page/Route 身份。
它只接受静态 Page path；`$param`、终止 `$...splat` 与 router-only boundary
会在 graph 校验失败。Layout 在两种 mode 中都会组合。这些错误不会激活另一套
创作模型。同一 Page 目录的 `index.html` 会提供该 MPA Page 的 Document 模板。

## Application extension 配置

插件持有的 Application 配置使用顶层 `extensions`：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
  extensions: {
    "@company/analytics": {
      enabled: true,
      channel: "checkout",
    },
  },
  plugins: [analyticsPlugin()],
});
```

每个 key 都必须由当前插件的 `applicationExtension()` declaration 注册。Core 会在
`setup()` 之前完成 default、merge 与 validation，然后把同一份值写入 normalized
Application。canonical SPA、canonical MPA 与显式 `application.routes` 输入使用
完全相同的合同。

value 必须是严格 static JSON。函数等可执行选项放入插件工厂，例如
`featurePlugin({ filter })`，或引用显式 generated/runtime module。不要在这里存放
secret：extension value 会进入 build graph。它们不会自动发送到浏览器；runtime
投影仍必须由插件显式 contribution。

不支持 `application.extensions`，因为 `application` 只描述显式 SPA route tree。
改用 canonical `page.*` 后，顶层 `extensions` 仍然有效。

## Page Scope 与配置

完整 Page 目录就是它的私有 ownership scope：

```text
src/pages/users/$userId/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── services.ts
└── components/
    └── ProfileCard.tsx
```

只有 `page.*` 是 Page entry。其他文件不会创建路由，因此 Page 代码不需要 `_`
前缀。“私有”描述框架发现和插件 ownership，不是安全边界或 import 限制。
后代目录拥有自己的 `page.*` 时，会创建一个更具体的 Page scope。

可选页面级配置使用同目录 `page.config.ts`：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "用户资料",
  meta: {
    description: "查看和管理用户资料。",
    keywords: "用户,资料",
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

evjs 构建 graph 时同步求值该 module。它必须 default-export plain object，且只
包含 static JSON data。支持的 core 字段是 `title`、`meta`、`render`、
`hydrate`、`prerender` 与 `rsc`。省略 `render` 时始终选择 CSR，且 CSR 必须
省略 `hydrate`。显式 SSR 与 SSG Page 可以使用 `hydrate: "none" | "load"`；
普通 SSR 默认值是 `"load"`，SSG 默认值是 `"none"`，RSC/PPR 保持 Page 级
不 hydration。
`meta` 是生成
`<meta name="key" content="value">` 的字符串 record；它不接受 `property`、
`charset`、link、script、函数或通用 head tree。插件持有的值必须放在
`extensions` 下已注册 namespaced key 中。

插件 API 在两种 mode 下定位相同 normalized Page identity。配置后的
core title/meta 会在两种 mode 下为 Page 物化。extension value 是 build-time
graph data，不会自动发布到浏览器 runtime；插件必须显式生成并挂载所需 runtime
projection。

## 其他配置

### Server

文件约定启用时，默认发现 `src/apis` 下 positive `api.*` server request-route
锚点。只有 root 确实不同才配置：

```ts
export default defineConfig({
  routing: { mode: "spa" },
  server: {
    basePath: "/__evjs",
    routing: {
      dir: "./src/apis",
    },
  },
});
```

`server.basePath` 统一控制 server function、PPR 和 RSC runtime 路径。它必须是
absolute pathname，由非空 ASCII URL-safe segment 组成；每个 segment 只能包含
字母、数字、`.`、`_`、`~` 或 `-`；空 segment、单独的 `.` 或 `..` segment、
动态 `:param`、通配 `*`、
percent escape 与原始非 ASCII 字符都无效。没有公开的
`server.functions.endpoint`。

服务端中间件约定：

- `src/middleware.ts`：全局 server middleware；
- `<server.routing.dir>/**/middleware.ts`：作用于同目录及后代 server file
  routes，默认为 `src/apis/**/middleware.ts`。

`server.routing: { dir }` 会同时定制 `api.*` 与 route middleware 的 discovery
root，不是关闭开关。

在 Page 的 `page.config.ts` 中用 `rsc: true` 启用 React Server Components。
Flight endpoint 从 `server.basePath` 派生，也可以用
`server.rsc: { endpoint: "/custom/flight" }` 覆盖；override 同样必须遵循
absolute ASCII 静态 pathname 规则，且 `server.rsc` 不是启用开关。

Server-function endpoint 是精确路径；只有存在 RSC Page 时才添加另一个精确的
RSC endpoint，也只有 PPR 启用时才保留以 PPR endpoint 为根的子树。BuildPlan
会拒绝 active endpoint 之间的冲突，以及 reserved endpoint 与 Page、redirect 或
server request Route pattern 之间的冲突。

### Dev Server

浏览器 dev server 默认端口 `3000`，server runtime 默认 `3001`。它们是优选
端口，被占用时可协调移动。

```ts
export default defineConfig({
  routing: { mode: "spa" },
  dev: {
    port: 4000,
    proxy: [
      {
        context: ["/api"],
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    ],
  },
  server: {
    dev: { port: 4001 },
  },
});
```

`dev.https` 接受 `false`、`true` 或 `{ key, cert }`。
`server.dev.https` 只接受 `false` 或显式 `{ key, cert }`；framework server 不会为
`true` 自动生成证书。

### Output

浏览器产物默认写入 `dist/client`，server 产物默认写入 `dist/server`。两个值都必须
是 BuildPlan `distDir`（framework 命令中为 `dist`）下的严格子目录，必须使用 `/`
作为可移植的分隔符，不得包含空、`.` 或 `..` path segment，并且必须在不经过
symbolic link 的前提下解析为互不相同、互不嵌套的目录，从而保证 adapter 写入与
cleanup 只作用于 framework 持有的输出树。

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist/public",
    server: "dist/runtime",
  },
});
```

Config 与 plugin setup 完成后，解析出的输出路径归 BuildPlan 持有。Adapter 使用
这些路径执行 cleanup、写入产物、生成 stats 与 manifest；`bundlerConfig()` hook
不能覆盖 framework 持有的 client 或 server 输出路径。

`output.crossOriginLoading` 接受 `false`、`"anonymous"` 或
`"use-credentials"`。

### Transport

只有浏览器需要跨域访问 server runtime 时才配置 `transport.baseUrl`：

```ts
export default defineConfig({
  routing: { mode: "spa" },
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

### Plugins

通过 `plugins` 注册插件。同一个 `Plugin` interface 可以注册 namespaced
Application、Page、Route、Document 配置 owner、定位 normalized graph，并承载
config、setup、contributions 与 lifecycle hooks。参见[插件](./plugins)。

### Bundler

Utoopack 是默认路径。只有明确需要验证/回退后端时才提供 bundler adapter：

```ts
import { defineConfig } from "@evjs/ev";
import { webpackAdapter } from "@evjs/bundler-webpack";

export default defineConfig({
  routing: { mode: "spa" },
  bundler: webpackAdapter,
});
```

每个 adapter 都声明 server rendering、RSC、PPR build capability，以及 HTML、
entry、route、server output、resolution 的 dev-plan update capability。
`ev inspect` 会报告选中的 adapter 与 plan gap；缺少必要 capability 时，build/dev
会在执行 adapter 前失败。

## 路由输入

`routing.mode` 会启用 canonical Page discovery。缺少 `routing` 时，一个无关的
`src/pages` 目录不会被解释为路由树。框架也不会通过 reader 开关识别其他 Page
文件名；参与 discovery 的 entry 必须符合 `page.*` 约定。

### 显式 SPA 路由配置

`application.routes` 的嵌套 `routes`、`page` 或 `component`、`layout`、`wrappers`、
redirect 和 document 配置会进入仅支持 SPA 的显式 route-tree normalizer。
`application.pageRoot` 是该显式输入中 `page` 与 `component` 共用的 Page 源码
根目录，默认值为 `./src/pages`；它不会改变 canonical 文件发现根目录。
`page` 值选择相对该根目录的 `page.*` 锚点目录；`component` 选择同一根目录内
的模块。`@/pages/...` 是指向已配置 `application.pageRoot` 的逻辑别名，bare 与
`./` component reference 也相对该根目录解析。component 逻辑路径以及解析
symlink 后的真实路径都不能逃逸该 Page 源码根目录；layout 与 wrapper 仍保持
项目源码 reference 的解析语义。`children` 会被拒绝，嵌套结构只使用
`routes`。每条显式 Route 可以携带严格静态、
namespaced 的 `extensions` bag；能力所属插件必须用
`routeExtension()` 注册每个 namespace。MPA 物化模式、alias 冲突以及 Page
根目录外的 component reference 会被拒绝。
静态 segment identity 按恰好一次 URL decode 后比较，因此 raw 与
percent-encoded alias 不能并存；decode 后为 `.` 或 `..` 的 segment 也会被拒绝，
因为 WHATWG URL 解析会在 route matching 之前移除它。

显式 component 以 `index.*` 或 `page.*` 结尾时，其所在目录会成为 Page scope。
`<application.pageRoot>/403.tsx` 这类 flat component 仍是 module scope，避免
它意外持有已配置根目录中的其他 flat Page；module-scoped Page 不会发现相邻
`page.config.ts`。

### Canonical Page tree

使用 `routing.mode` 时，每个公开 Page 位于其 URL 对应目录并使用 `page.*`。
静态 title、named metadata、rendering setting 与 plugin-owned Page value 放在
相邻 `page.config.ts`。Dynamic、终止 catch-all 与 pathless segment 分别使用
`$param`、`$...splat` 与 `(group)` 目录。运行 `ev inspect` 可审核 normalized
Page/Route/Document graph。

Provider id 只可能出现在 raw CoreGraph/debug artifact 中作为内部 provenance。
普通 `ev inspect` routing 输出隐藏它，并报告归一化的 Page、route、source 与
document 信息；provider 不是用户可选择的路由架构。

以下字段不属于公共配置：

- `app`
- `pages`
- 顶层 `routes`
- 顶层 `html`
- `application.topology` 或 `application.mode`
- `server.entry`
- `server.functions`
- `server.functionRuntime`
- `routing.routes`
- `routing.entry`
- 顶层 `functions` 或 `serverFunctions`
