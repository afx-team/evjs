# 配置

evjs 为 SPA 和 MPA 提供同一种应用创作模型：

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
客户端 `routing` 声明一起配置。框架不提供粒度更细的约定关闭开关。

仅支持 SPA 的 `application.routes` 显式 route-tree 配置不依赖文件约定。reachable
且带 `"use server";` 的模块，以及插件 contribution 生成的模块也不依赖文件约定。

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

## Application 插件配置

在顶层 `plugins` 数组中通过一次工厂调用安装插件并提供 Application 配置：

```ts
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/evjs-plugin-analytics";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    analytics({
      endpoint: "/events",
      debug: false,
    }),
  ],
});
```

该工厂同时完成插件安装和 Application 配置。参数类型由插件包直接提供，因此
不需要维护第二个 namespace、注册调用或配置对象。条件项可以使用 `false`、
`null` 或 `undefined`；运行时会忽略这些非活跃项。可能进入 falsy 分支的条目不保证
安装，因此不会向 Page config 暴露 plugin id。Page 合同有 defaults，且插件与
Application options 需要保持启用、但每个 Page 必须显式 opt in 时，使用
`plugin.forPages(options)`。

插件合同允许时，Application 配置可以包含类型安全的可执行选项或显式模块引用。
不要把 secret 放进插件会投影到 generated file 或浏览器 runtime 的值中。

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
  plugins: {
    analytics: {
      channel: "profile",
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
`charset`、link、script、函数或通用 head tree。已安装且支持 Page 配置的插件使用
`plugins` 下的同一个 canonical plugin id。Page module 不需要 import 插件包：
`ev prepare`、
`ev dev` 与 `ev build` 会生成 `src/plugin-types.d.ts`，稳定桥接 `ev.config.ts` 的
静态类型。TypeScript 直接从该配置类型推导 plugin id 与 Page value，但只包含静态上
保证安装的条目。JavaScript 配置不会把 Page registry 扩散为 `any`；需要 Page
插件补全时请使用 `ev.config.ts`。

Application 与 Page 配置是两个独立的插件合同。evjs 不会把 Application 工厂的
对象合并到 Page value。在任一合同内部，authoring 字段会先深度合并到该合同的
defaults，再进行校验。普通工厂调用在 Page 有 defaults 时，会让省略插件项的 Page
使用 defaults；没有 defaults 时，省略会关闭该 Page。defaultable Page 合同会暴露
`forPages()`，并始终把省略视为关闭；non-defaultable 合同本身已经是 opt-in-only。
`false` 对当前 Page 禁用插件，`true` 要求 Page defaults，对象则在合并 Page
defaults 并校验后启用插件。Page 对象必须是严格 static JSON。

插件 API 在两种 mode 下定位相同 normalized Page identity。配置后的
core title/meta 会在两种 mode 下为 Page 物化。Page 插件值是 build-time graph
data，不会自动发布到浏览器 runtime；插件必须显式生成并挂载所需 runtime
projection。插件根据 normalized Page 派生 Route 或 Document 行为，不再暴露单独
的 Route/Document 插件配置。

## 其他配置

### Polyfill

生产环境的低端浏览器兼容由 `target` 显式控制。开发模式保留适配器现有的客户端
target 和依赖转译范围，也不注入 core-js；省略 `target` 时，生产构建也保留该
默认行为。

配置 target 对象会为生产构建选择支持的 Android 与 iOS 版本、输出 ES5 语法，
并打包 framework-owned `core-js/stable` 桥接模块。每个生产客户端 facade 都会先
import 该模块，再执行插件的 `polyfill` entry contribution 和应用入口。这会补齐
ECMAScript 内建能力，同时增大生产客户端 bundle 体积。

```ts
export default defineConfig({
  target: { android: 5, ios: 8 },
});
```

业务可以提高任一版本基线，例如 `target: { android: 6, ios: 10 }`。Android 5 与
iOS 8 是允许配置的最低版本；两个字段都必须提供有限数字。

如需改用单独托管的 core-js UMD bundle，可以在 target 旁配置一个绝对 HTTP(S) URL：

```ts
export default defineConfig({
  target: { android: 6, ios: 10 },
  polyfill: {
    coreJs: "https://cdn.example.com/core-js-bundle.min.js",
  },
});
```

外部模式会移除 bundled core-js import。所有包含客户端 JavaScript 的生产 SPA、
MPA、SSR 与 SSG Document 都会在 EVJS client runtime 内嵌数据和带 `defer` 的
应用脚本之前插入普通阻塞式 `<script src="...">`。配置 URL 会原样保留，不与
`publicPath` 拼接；开发 Document 和不包含客户端 JavaScript 的 Document 不会插入
该标签。

`polyfill` 只能与 `target` 一起配置，避免只加载 core-js、却没有降级
JavaScript 语法。`polyfill.coreJs` 只接受绝对 `http:` 或 `https:` URL。相对路径、其他 URL
scheme、非字符串值和未知 `polyfill` 字段都会在配置解析阶段报错。该设置不会
注入 `fetch`、`AbortController`、Streams 等 Web API polyfill，也不会改变 Node、
构建期或 server 编译 target。

### Server

文件约定启用时，positive `api.*` server request-route 锚点固定从 `src/apis`
发现：

```ts
export default defineConfig({
  routing: { mode: "spa" },
  server: {
    basePath: "/__evjs",
    resolve: {
      alias: { "server-sdk": "./src/server/sdk.ts" },
    },
    externals: {
      "native-addon": "commonjs native-addon",
    },
  },
});
```

`server.resolve` 与 `server.externals` 只作用于 server build entry，不会修改
client compiler。`server.resolve.alias` 是字符串映射，其中 project-relative
replacement 从应用根目录解析。`server.externals` 把 module specifier 映射为
`"commonjs native-addon"` 这类 external request。所有 key 与 value 都必须是无首尾
空白的非空字符串。配置解析会将它们作为 server build 专用的字符串映射放入
`plan.server.externals`。

Webpack 和 Utoopack adapter 在 client/server 混合构建中都支持这两个配置。
Utoopack 会将 `server.resolve.alias` 映射到 server-scoped resolver，因此同名的
specifier 可以在 client 和 server entry 中解析到不同目标；其他顶层 alias 仍然
由两类 entry 共享。

`server.basePath` 统一控制 server function、PPR 和 RSC runtime 路径。它必须是
absolute pathname，由非空 ASCII URL-safe segment 组成；每个 segment 只能包含
字母、数字、`.`、`_`、`~` 或 `-`；空 segment、单独的 `.` 或 `..` segment、
动态 `:param`、通配 `*`、
percent escape 与原始非 ASCII 字符都无效。

服务端中间件约定：

- `src/middleware.ts`：全局 server middleware；
- `src/apis/**/middleware.ts`：作用于同目录及后代 server file routes。

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
    cliShortcuts: true,
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

`dev.https` 接受 `false`、`true` 或 `{ key, cert }`。默认 Utoopack adapter
只接受 boolean 形式；遇到显式证书时会直接报错而不是静默丢弃。需要自定义 client
dev 证书时应选择 Webpack adapter。
`server.dev.https` 只接受 `false` 或显式 `{ key, cert }`；framework server 不会为
`true` 自动生成证书。

`dev.cliShortcuts` 是严格 boolean，用于控制交互式 terminal shortcuts 引擎，默认值为
`true`。Core 不添加任何按键；插件通过 descriptor 顶层的 `cliShortcuts()` 声明快捷键。
该引擎在 CI 和非 TTY 场景下仍为 no-op。`ev dev --no-shortcuts` 会在整次运行中覆盖该配置，
包括 replacement Session。除此之外，监听到该配置变化时，evjs 会通过正常的 immutable
Session replacement 应用新值。参见[插件 CLI 快捷键](./dev#插件-cli-快捷键)。

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

Plugin `configure()` 与 `setup()` 完成后，解析出的输出路径归 BuildPlan 持有。Adapter 使用
这些路径执行 cleanup、写入产物、生成 stats 与 manifest；`configureBundler()` hook
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

通过 `plugins` 安装插件，通常写成
`pluginFactory(applicationConfig)`。插件可以声明独立 Page 合同，其 canonical `id`
会出现在相邻 `page.config.ts` 中。同一个 Plugin descriptor 承载 `configure()`、
`setup()`、`emitIR()` 与 lifecycle hooks。参见[插件](./plugins)。

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

每个 adapter 都声明 server rendering、RSC 与 PPR build capability。
`ev inspect` 会报告选中的 adapter 与 build-capability gap；缺少必要 capability 时，
build/dev 会在执行 adapter 前失败。开发期间，adapter 负责一个 immutable Session
内的普通 module watch/HMR。Framework input 发生语义变化时，Supervisor 会替换完整
Session；adapter input 在该 Session 的整个生命周期内保持固定。

## 路由输入

`routing.mode` 会启用 canonical Page discovery。缺少 `routing` 时，一个无关的
`src/pages` 目录不会被解释为路由树。框架也不会通过 reader 开关识别其他 Page
文件名；参与 discovery 的 entry 必须符合 `page.*` 约定。

### 显式 SPA 路由配置

`application` 与 `routing` 不能同时声明。`application.routes` 的嵌套 `routes`、
`page` 或 `component`、`layout`、`wrappers`、
redirect 和 document 配置会进入仅支持 SPA 的显式 route-tree normalizer。
`application.pageRoot` 是该显式输入中 `page` 与 `component` 共用的 Page 源码
根目录，默认值为 `./src/pages`；它不会改变 canonical 文件发现根目录。
`page` 值选择相对该根目录的 `page.*` 锚点目录；`component` 选择同一根目录内
的模块。`@/pages/...` 是指向已配置 `application.pageRoot` 的逻辑别名，bare 与
`./` component reference 也相对该根目录解析。component 逻辑路径以及解析
symlink 后的真实路径都不能逃逸该 Page 源码根目录；layout 与 wrapper 仍保持
项目源码 reference 的解析语义。`children` 会被拒绝，嵌套结构只使用
`routes`。`exact: true` 只接受为 terminal-match 结构断言；`exact: false` 与
exact Route 下的嵌套路由都会被拒绝，且 `exact` 不会写入 graph。显式 Route 或
Document 对象不承载插件配置；Page-aware 插件根据 normalized Page 派生这些
contribution。MPA 物化模式、alias 冲突以及 Page 根目录外的 component reference
会被拒绝。
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

公共配置面以本页描述的 schema 为准。使用 `ev inspect` 查看归一化后的 Page、
Route、source、Document 与 diagnostic。
