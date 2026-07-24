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

该配置会关闭 `src/pages` 下的 `page.*` 发现、`src/apis` 下的 server
file-route 发现，以及全局与 route-scoped middleware 文件发现。它不能和显式
`routing` 或 `server.routing` 声明一起配置。框架不提供粒度更细的约定关闭
开关。

仅支持 SPA 的 `application.routes` migration input 不依赖文件约定。reachable
且带 `"use server";` 的模块，以及插件 contribution 生成的模块也不依赖文件约定。
已移除的 `app`、`pages` 与顶层 `routes` 声明会产生迁移错误。

## Routing

`routing` 启用 canonical 客户端 Page-and-Route 约定。

| 字段 | 含义 |
| --- | --- |
| `mode` | `"spa"` 或 `"mpa"`，只改变物化方式。 |
| `dir` | 项目相对 Page 路由根目录，默认 `./src/pages`。 |
| `html` | 共享 HTML 模板，默认 `./index.html`。 |
| `mount` | 共享挂载选择器，默认 `#app`。 |

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
| 源路径 | 相对 `routing.dir` 的路由目录 | 相同的源路径 |

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
Application。canonical SPA、canonical MPA 与临时 Bigfish
`application.routes` 输入使用完全相同的合同。

value 必须是严格 static JSON。函数等可执行选项放入插件工厂，例如
`oneApiPlugin({ filter })`，或引用显式 generated/runtime module。不要在这里存放
secret：extension value 会进入 build graph。它们不会自动发送到浏览器；runtime
投影仍必须由插件显式 contribution。

不支持 `application.extensions`，因为 `application` 只是临时 Bigfish SPA
route-tree migration input。路由树迁移到 canonical `page.*` 后，顶层
`extensions` 仍然有效。

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
`hydrate`、`prerender` 与 `rsc`。`hydrate` 只接受 `"none"` 或 `"load"`。
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

文件约定启用时，默认发现 `src/apis` 下的服务端文件路由。只有目录确实不同才配置：

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

`server.basePath` 统一控制 server function、PPR 和 RSC runtime 路径。没有
公开的 `server.functions.endpoint`。

服务端中间件约定：

- `src/middleware.ts`：全局 server middleware；
- `src/apis/**/middleware.ts`：只作用于后代 server file routes。

`server.routing: { dir }` 只定制 discovery root，不是关闭开关。

在 Page 的 `page.config.ts` 中用 `rsc: true` 启用 React Server Components。
Flight endpoint 从 `server.basePath` 派生，也可以用
`server.rsc: { endpoint: "/custom/flight" }` 覆盖；`server.rsc` 不是启用开关。

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

浏览器产物默认写入 `dist/client`，server 产物默认写入 `dist/server`。

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

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

通过 `plugins` 注册插件。同一个 `Plugin` interface 可以定位归一化 graph、
提供 Page 扩展，并承载 config、setup、contributions 与 lifecycle hooks。参见
[插件](./plugins)与[插件迁移](./plugin-migration-0.2-to-0.3)。

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

## 迁移存量应用

`routing.mode` 会启用 canonical Page discovery。缺少 `routing` 时，一个无关的
`src/pages` 目录不会被解释为路由树。Core 0.3 不暴露 Smallfish 或 evjs 0.2
reader 开关；启动应用前先转换这些源码树。

### Bigfish SPA 路由配置

Bigfish 风格的嵌套 `routes`、`component`、`layout`、`wrappers`、redirect 和
document 配置可以进入仅支持 SPA 的迁移 normalizer。历史 `children` 拼写
会被拒绝，因为当前 Umi/Bigfish 配置使用 `routes`。normalizer 还会把文档列明
的 access/menu metadata 保留在已注册的 `@evjs/bigfish-route` Route extension
中，但不会接受任意 Route extension bag。MPA 物化模式、Alias 冲突以及项目
外部 component reference 会被拒绝。

显式 component 以 `index.*` 或 `page.*` 结尾时，其所在目录会成为 migration
Page scope。`src/pages/403.tsx` 这类 flat component 仍是 module scope，避免它
意外持有 `src/pages` 中的其他 flat Page；module-scoped Page 不会发现相邻
`page.config.ts`。渐进迁移 Page config 时，应先把 flat component 移入独立目录
（显式 route 可暂时引用 `403/index.*`），再添加 `page.config.ts`，最后在启用
canonical `routing` 前把 entry 重命名为 `page.*`。

把 component 模块移动到对应路由目录，并把每个路由 entry 重命名为 `page.*`。
目录会编码相同的路径树；文件树 canonical 后，设置
`routing.mode: "spa"` 并删除显式 route 声明。

### Smallfish 应用

运行 Core 0.3 前，保留或调整每个公开 URL 目录，把其中的 `index.*` entry
重命名为 `page.*`，把 `config.json` 的 title 与受支持 `<meta name>` 项映射到
core `title` 和 `meta`，其余插件持有值移入 namespaced `page.config.ts`
extension。删除 `config.json` 后，只配置 `routing.mode: "mpa"`。

### evjs 0.2 应用

运行 Core 0.3 前，把每个已发布 filename route 移到 URL 对应目录并把 entry
重命名为 `page.*`。把 title、受支持 named metadata、rendering 与插件持有的
Page setting 移到同目录 `page.config.ts`，然后只配置
`routing.mode: "spa" | "mpa"`。转换完成后运行 `ev inspect`，验证 normalized
Page/Route/Document graph。

Provider id 只可能出现在 raw CoreGraph/debug artifact 中作为内部 provenance。
普通 `ev inspect` routing 输出隐藏它，并报告归一化的 Page、route、source 与
document 信息；provider 不是用户可选择的路由架构。

以下旧字段仍不支持：

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
