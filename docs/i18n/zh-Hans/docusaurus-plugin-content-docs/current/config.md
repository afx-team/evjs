# 配置

evjs 默认零配置。多数应用只需要在 `ev.config.ts` 中选择 SPA 或 MPA
文件路由，并配置服务端/runtime 能力。只有页面文件约定无法描述目标输出时，才使用更底层的
app 和 page 输出配置。

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

## 默认值

| 配置 | 默认值 |
|------|--------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `output.crossOriginLoading` | `"anonymous"` |
| `routing.mode` | `spa` |
| `dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.basePath` | `/__evjs` |
| 服务端函数端点 | `${server.basePath}/fn` |

服务端函数端点从 `server.basePath` 派生，没有单独的公开函数端点配置。

顶层 config object 只接受 `entry`、`html`、`output`、`dev`、`server`、
`transport`、`app`、`routing`、`bundler`、`plugins` 和 `pages`。
生成的 app 声明、页面路由运行时接线、server-function endpoint 等框架
metadata 都由 evjs 派生，不需要也不能直接配置。

## 输出 HTML 资源

evjs 默认会为注入到输出 HTML document 中的 JavaScript 和 CSS 资源标签添加
`crossorigin="anonymous"`，并让浏览器 chunk loader 对动态加载的 chunk 使用
同一策略。设置 `output.crossOriginLoading` 可以修改或关闭这个策略：

```ts
export default defineConfig({
  output: {
    crossOriginLoading: "anonymous",
  },
});
```

`output.crossOriginLoading` 可设置为 `false`、`"anonymous"` 或
`"use-credentials"`。设置为 `false` 时不会添加该属性，动态 chunk 使用 bundler
默认行为。
如果不同 HTML document 或单个首屏资源需要不同属性，请使用 `transformHtml` 插件。

## 路由

`src/pages` 是主要客户端路由模型。SPA 模式会从页面文件构建一个
框架托管的应用：

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

MPA 模式使用同一套文件，但每个路由输出独立页面，不引入客户端路由器：

```ts
export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

当项目存在 `src/pages`，且项目没有声明显式的 `app` 或 `pages`
配置时，SPA 路由会自动启用。
需要显式关闭文件路由发现时，设置 `routing: false`。
导出的 config 必须是 object。启用并配置选项时，`routing` 必须是 object；array 和
`null` 都会被拒绝。

SPA 模式可以使用根布局模块。默认情况下，evjs 会在路由目录旁边查找唯一的
`layout.*` 或 `layout/index.*` 源码模块，例如 `src/pages` 对应
`src/layout.tsx` 或 `src/layout/index.tsx`。如果存在多个候选文件，需要只保留一个，
或显式配置 `routing.layout`。如果迁移应用的外框在其他位置，也可以通过
`routing.layout` 显式指定模块路径。显式布局模块必须是源码模块，不能是声明文件、
测试/spec、Storybook、client-only 或 server-only 文件；如果 SPA 不需要外部根布局，可以设置为
`false`：

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    layout: "./src/shell/AppLayout.tsx",
  },
});
```

MPA 模式不支持 `routing.layout`。路由目录内的 layout 模块也是 SPA 路由约定。
MPA 页面需要共享外框时，应像普通 React 代码一样组合共享组件；如果只是文档外壳相同，
可以复用页面 HTML 模板。

`routing.mode` 必须是 `spa` 或 `mpa`。提供 `routing.dir`、`routing.html`
或 `routing.mount` 时，它们必须是非空字符串。`routing.layout` 必须是
`false` 或非空模块路径。

只有手动 bootstrap 单应用时，才使用顶层 `entry` / `html`。使用
`src/pages` 的应用不应该额外手写客户端 router 或 framework bootstrap：

```ts
export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

提供顶层 `entry` 和 `html` 时，它们必须是非空字符串。更底层的 `app`
声明中，字符串写法或 `{ source }` 指向 lifecycle module；`{ entry, html?, mount? }`
指向自行 bootstrap 的浏览器入口：

```ts
export default defineConfig({
  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },
});
```

`app` 必须是字符串模块路径或 object；`null` 和 array 会被拒绝。object 形式的
`app` 必须且只能指定 `source` 或 `entry` 之一。提供 `source`、`entry`、`html`
或 `mount` 时，它们必须是非空字符串。object 形式的 `app` 只接受 `source`、
`entry`、`html` 和 `mount`。
顶层 `html`、`app.html`、`routing.html` 和 `pages.*.html` 中配置的 HTML
模板必须指向文件，并会在 bundler 运行之前被校验。配置对象声明了 `mount`
时，该 selector 必须能在对应 HTML 模板中匹配到元素。共享模板是允许的，
每个声明的 mount selector 都会独立校验。

## 页面

`pages` 是独立页面输出和非约定式路由的显式底层 API。当页面集合直接来自
`src/pages` 时，优先使用 `routing: { mode: "mpa" }`。字符串页面是
framework-managed React 组件模块的简写；只有页面需要自己控制 bootstrap 时才使用
`{ entry }`：

```ts
export default defineConfig({
  pages: {
    home: "./src/pages/Home.tsx",
    about: {
      entry: "./src/pages/about/main.tsx",
      html: "./src/pages/about/index.html",
    },
  },
});
```

`{ component }` 对象写法等价于字符串简写；当页面需要 `path`、`html` 或
`mount` 时使用对象写法：

```ts
export default defineConfig({
  pages: {
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      html: "./src/pages/public.html",
      mount: "#app",
    },
  },
});
```

Component page 对象也可以直接声明 framework render metadata：

```ts
export default defineConfig({
  pages: {
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      render: "ssr",
      hydrate: "visible",
    },
  },
});
```

`pages` 必须是 object map。Page id 必须是非空 build identifier：只能使用字母、
数字、下划线或连字符，不能包含路径分隔符。每个 page value 必须是字符串模块路径或
page object，并且每个页面必须且只能指定一种模块契约：`entry`、`component`
或 `app`。这些模块路径必须是非空字符串。Page object 只接受 `path`、`entry`、
`component`、`app`、`html`、`mount`、`render`、`hydrate`、`prerender` 和 `rsc`。
提供 `path` 时必须以 `/` 开头，并且不能和其他显式页面重复。动态参数名不会产生不同的
URL shape，所以 `/users/:id` 和 `/users/:userId` 会冲突。它是 URL pathname，因此不能包含空白字符、
query string 或 hash。`html` 和 `mount` 在提供时也必须是非空字符串。Page id 会参与生成
build entry name 和 HTML 文件名，因此不能与 app entry 或其他页面输出冲突。

```tsx
// src/pages/dashboard/Page.tsx
export const render = "ssr";
export const hydrate = "load";

export default function DashboardPage() {
  return <main>Dashboard</main>;
}
```

配置了 `path` 时，该页面也会贡献 framework route。SSR、SSG、PPR 等由框架服务端处理的页面应把 URL 和 component 放在配置里。
Rendering metadata 可以放在 component page config 中，也可以作为组件模块的
static exports。配置里显式声明的字段优先；未声明的字段会继续从 static exports
中补齐。未配置 `path` 时，页面会输出为 `campaign.html` 这样的 HTML 文档。
Route-derived page id 必须唯一；例如 `/admin/panel` 和 `/admin_panel` 都会派生出
`admin_panel` 时，evjs 会报告冲突。生成的 id 会冲突时，请重命名其中一个
route 文件，或改用显式 `pages` 配置并提供唯一 page id。

### Page Module 静态导出

当对应的 component page config 字段没有声明时，evjs 会从 framework-managed
page module 中读取以下 named static exports。请使用字面量值，这样 graph analysis
不需要执行用户代码也能解析。
无效的字面量值会在 app graph analysis 阶段报错，并且发生在 bundling 之前。
PPR 不是独立的 `render` 值；请使用 `render = "ssr"` 搭配
`prerender = { partial: true }`。
`prerender` 对象只能包含 `partial`、`delivery` 和 `revalidate`，并且至少要声明
其中一个属性。`revalidate` 必须是 `false` 或表示秒数的正整数。没有选项的
full prerendering 请使用 `true`。
Analyzer 支持直接的 `export const` 声明，也支持本地 export specifier，
例如 `const mode = "ssr"; export { mode as render };`。Page metadata 不会跟随
来自其他模块的 re-export；把 metadata 名称从其他模块重新导出会被报告为无效。
运行时 metadata export 必须是带静态 initializer 的本地变量；
`export let render;` 这类未初始化声明、function export 和 class export 都是无效的。
`export type { mode as render }` 这类 type-only export
以及 `export declare const render: "ssr"` 这类 ambient declaration 都会被忽略，
因为它们不会产生运行时值。每个 metadata 名称只能导出一次；重复的 `render`、
`hydrate`、`prerender` 或 `rsc` 导出是 graph-analysis 错误，而不是 last-write-wins。

| 导出 | 可选值 | 含义 |
| --- | --- | --- |
| `render` | `"csr"` | 客户端渲染页面。页面在浏览器中 mount，不生成 server document renderer。省略 `render` 时默认是该模式。 |
| `render` | `"ssr"` | 服务端渲染 document。框架服务端为请求生成 HTML，然后浏览器按 `hydrate` 策略 hydration。需要启用 `server`。 |
| `render` | `"ssg"` | 静态 document 意图。manifest 会把页面标记为 fully prerendered/static，默认 hydration mode 是 `none`。不需要动态服务端能力时，deployment adapter 可以把它作为静态 HTML 服务。 |
| `hydrate` | `"none"` | 不对整页做浏览器 hydration。适合静态页面、RSC document，或通过显式 islands/regions 建模交互的 PPR shell。 |
| `hydrate` | `"load"` | 页面 runtime 加载后 hydration。非 SSG 的 server-rendered 页面默认是该模式。 |
| `hydrate` | `"visible"` | 声明 mount point 可见后再 hydration。不支持 visibility scheduling 的 runtime/adapter 可以回退到 `load`。 |
| `hydrate` | `"idle"` | 声明浏览器空闲时再 hydration。不支持 idle scheduling 的 runtime/adapter 可以回退到 `load`。 |
| `prerender` | `true` | 标记非 CSR 页面可 full prerender，但不启用 partial prerendering。manifest 会输出 `rendering.prerender = "full"`；如果初始 HTML 需要静态交付，请使用 `render = "ssg"`。 |
| `prerender` | `{ partial: true }` | 启用 experimental PPR。公开编写模型是 React `Suspense`；evjs 0.2 尚未实现任意 Suspense boundary 的 runtime postponed/resume。 |
| `prerender.delivery` | `"merge"` | 非流式 PPR delivery。服务端解析 shell 和 regions 后，返回一个完整 HTML response。partial prerendering 默认使用该模式。 |
| `prerender.delivery` | `"stream"` | 流式 PPR delivery。服务端可以先 flush shell，再把已完成的 regions patch 到同一个 response 中。 |
| `prerender.revalidate` | 正整数 | 声明 prerendered output 的 revalidation 间隔，单位是秒。 |
| `prerender.revalidate` | `false` | 声明 prerendered output 不自动 revalidate。 |
| `rsc` | `true` | 启用 RSC 页面路径。需要和 `render = "ssr"` 一起使用。RSC document 默认使用 `hydrate = "none"`；显式声明 `load`、`visible` 或 `idle` hydration 会被拒绝。需要当前 bundler/server adapter 支持 `server.rsc`。 |

`rsc = false` 会作为兼容性的 no-op 被接受，但会产生 warning。除非页面要改成
`rsc = true` 的 RSC 页面，否则请删除它。

### 渲染支持契约

页面渲染模式刻意保持收敛。不支持的组合会在 bundling 之前失败，因此 deployment
adapter 可以信任 manifest：

| 能力 | 必需页面契约 | SPA document 输出 | MPA document 输出 | Server/runtime 要求 | 不支持的组合 |
| --- | --- | --- | --- | --- | --- |
| CSR | 省略 `render`，或导出 `render = "csr"` | App HTML fallback | 每个页面一个 HTML document | 不需要 server | 无 |
| SSR | `render = "ssr"` | route-owned server document | route-owned server document，不输出静态 HTML 文件 | Framework server document route | `server: false` |
| SSG | `render = "ssg"` | App HTML fallback，并为 route page 记录 static metadata | 独立静态 HTML document | 生成和 manifest linking 阶段需要 server build | `server: false` |
| PPR | component page 上声明 `render = "ssr"` + `prerender = { partial: true }` | 带服务端合成 regions 的 route-owned server document | 带服务端合成 regions 的 route-owned server document | Framework server document route，另有可选 `runtime.server.ppr` direct/debug endpoint | 同页 RSC、整页 hydration entry、`server: false` |
| RSC | component page 上声明 `render = "ssr"` + `rsc = true` | route-owned server document 加 RSC Flight endpoint | route-owned server document 加 RSC Flight endpoint | Framework server document route 加 `runtime.server.rsc` | 同页 PPR、`hydrate` 不是 `"none"`、`server: false` |
如果同一个页面同时需要 RSC 数据流和 partial prerendered regions，当前请拆成不同
page routes。单个 component page 必须在 `rsc = true` 和
`prerender = { partial: true }` 之间二选一。

`server: false` 只适用于 CSR 页面、MPA client entries 和静态资源。
SSR、SSG、PPR、RSC、server functions 和 server routes 都要求构建时启用 framework server。

PPR 页面推荐用普通 React `Suspense` 表达可延后内容：

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
    },
  },
});
```

```tsx
import { Suspense } from "react";
import Offer from "./Offer";
import OfferSkeleton from "./OfferSkeleton";

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

export default function CampaignPage() {
  return (
    <Suspense fallback={<OfferSkeleton />}>
      <Offer />
    </Suspense>
  );
}
```

evjs 0.2 中 partial prerendering 仍是 experimental。稳定的编写 API 是
`prerender = { partial: true }` 加 React `Suspense`；用户不应声明或依赖 PPR
region id。当前还没有实现任意 Suspense boundary 的 runtime postponed/resume。
为了兼容现有服务端合成实现，graph analysis 仍能把一个受限形态拆成内部 region
renderer：`Suspense` boundary 的直接子节点是静态声明的
`React.lazy(() => import("./..."))` 组件。生成的 region id 是框架内部 opaque
细节，未来可能变化。

兼容 region module 可以声明以下静态导出：

| 导出 | 可选值 | 含义 |
| --- | --- | --- |
| `cache` | `"no-store"` | 每次都动态渲染 region。适合请求相关或用户相关数据。 |
| `cache` | `{ revalidate: 正整数 }` | 缓存 region output，并在给定秒数后 revalidate。 |
| `hydrate` | `"none"` | 不在浏览器中 hydrate region。server-only region 默认使用该模式。 |
| `hydrate` | `"load"` | region client runtime 加载后 hydration。 |
| `hydrate` | `"visible"` | 声明 region 可见后 hydration。不支持 visibility scheduling 的 runtime 可以回退到 `load`。 |
| `hydrate` | `"idle"` | 声明 region 在浏览器空闲时 hydration。不支持 idle scheduling 的 runtime 可以回退到 `load`。 |

无效的 region 静态导出字面量会在 graph analysis 阶段、bundling 之前报错，
与 page module metadata 的校验保持一致。
Region metadata 也遵循和 page metadata 相同的 runtime export 规则：
runtime export 必须是带静态 initializer 的本地变量。重新导出的 metadata、
function export 和 class export 都是无效的；type-only export 和 ambient
`declare` 声明会被忽略。每个 region metadata 名称只能导出一次；重复的 `cache`
或 `hydrate` 导出是 graph-analysis 错误。

框架合成 PPR page response 时，会根据 region cache 策略派生默认
`Cache-Control`。只要任意 region 是 `"no-store"` 或省略 `cache`，page response
默认使用 `no-store`；如果所有 regions 都声明 `{ revalidate }`，page response 默认使用
最小 region `s-maxage`。如果 shell renderer 自己返回了 `Cache-Control`，框架会保留它。
服务端 adapter 可以在运行时设置 `framework.ppr.staleWhileRevalidate`。设置后，可缓存的
PPR region response 和合成后的 page response 会包含 `stale-while-revalidate`，
过期但仍在 stale 窗口内的 region entry 会先返回给请求，同时由框架在后台刷新缓存。

`prerender.delivery` 控制初始 document response。`"merge"` 是默认非流式模式：
框架服务端先渲染 shell 和 regions，再返回完整 HTML。`"stream"` 会先发送 shell，
再在同一个 HTML response 中把已完成的 regions patch 到页面里。两种模式的首屏
导航都不要求浏览器主动请求 `/__evjs/ppr`。

PPR 页面由服务端合成，不会生成整页客户端 hydration entry。需要交互能力的
PPR 页面应显式建模为 client islands 或 region-level hydration，而不是 hydrate
整个 page shell。

RSC 页面使用 SSR document render mode，并通过 `rsc = true` 显式开启 RSC：

```ts
export default defineConfig({
  pages: {
    insights: {
      path: "/insights",
      component: "./src/pages/Insights.tsx",
    },
  },
  server: {
    rsc: true,
  },
});
```

```tsx
// src/pages/Insights.tsx
export const render = "ssr";
export const rsc = true;
export const hydrate = "none";

export default function InsightsPage() {
  return <main>Insights</main>;
}
```

RSC 页面可以省略 `hydrate = "none"`，因为这是 RSC document 的默认值。
如果显式声明 `hydrate`，则必须是 `"none"`；RSC document 不支持整页浏览器
hydration 模式。
RSC Flight response 默认使用 `Cache-Control: no-store`，因为它可能依赖 request
状态和服务端数据。RSC renderer 显式返回的 `Cache-Control` 会被保留。
RSC 页面不能同时声明 partial prerendering；在组合 runtime contract 可用之前，
请把 RSC 和 PPR 行为拆到不同 page routes。

当前 webpack validation adapter 已经覆盖完整 RSC 请求链路。默认 Utoopack adapter
仍需要补齐等价的 client/server reference metadata 后，才能运行同样路径。

`react-server-dom-webpack` 是 evjs client 和 server runtime 的可选 peer
dependency。直接使用 RSC 的应用需要安装它，或者使用提供 RSC runtime path 的
bundler/server adapter。

服务端渲染的 RSC document 会包含一个很小的 `__EVJS_RSC_BOOTSTRAP__` payload，
用于告诉 client runtime Flight endpoint、page id、mount selector、public path、页面
assets 和可选 page route metadata。client runtime 会在请求 Flight 数据前校验该
payload；JSON 格式错误、非法 build/page identifier、非法 public path、格式错误的页面
assets 或缺少必填字段都会报告为启动错误。自定义 runtime 调用
`startReactRscPageRuntime({ document })` 时，会用这个 document 同时查找 bootstrap
和解析 mount selector。

## 服务端

纯 CSR 可以禁用服务端：

```ts
export default defineConfig({ server: false });
```

`server: false` 时：

- 构建输出为扁平 `dist/`；
- `"use server"` 模块会成为构建错误；
- dev 模式不会配置框架服务端代理。

框架服务端边界默认是 `/__evjs`。只有部署平台要求固定路径时，才需要配置
`server.basePath`：

```ts
export default defineConfig({
  server: {
    entry: "./src/server.ts",
    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

提供 `output`、`dev`、`server`、`server.dev` 和 `transport` 时，它们都必须是
object；使用 `server: false` 关闭框架服务端。提供 `server.entry` 时，它必须是非空模块路径；
evjs 会在 app graph analysis 阶段、bundler 运行之前校验 `server.entry` 等已配置的
source path。`server.basePath` 必须是以 `/` 开头的非空 URL pathname，不能包含空白字符、query
string 或 hash；尾部 `/` 会被归一化移除。如果 `server.rsc` 配置为 object，
`server.rsc.endpoint` 也遵循同样的 URL pathname 规则。`dev.https` 和
`server.dev.https` 中的 key/cert 值必须是非空字符串，HTTPS object config 不能是
`null` 或 array。`dev.port` 和 `server.dev.port` 必须是 `1` 到 `65535` 之间的 TCP
端口整数。

派生路径：

```txt
/__evjs/fn       服务端函数
/__evjs/ppr      存在 PPR 页面时的 region direct/debug endpoint
/__evjs/rsc      启用 server.rsc 时的 Flight endpoint
```

PPR 页面首屏不会要求浏览器调用 `/__evjs/ppr`；框架服务端在服务 page route 时解析
内部 regions。direct/debug region 调用必须精确使用
`GET /__evjs/ppr/<pageId>/<regionId>`；`pageId` 和 opaque internal `regionId`
使用 build identifier 规则，多余 path segment 不会匹配。
成功的 RSC page model 响应必须使用 `Content-Type: text/x-component`，
可以附带 content-type 参数。
客户端 RSC debug JSON helper 只会解析以 `Content-Type: application/json`
返回的响应，可以附带 content-type 参数。
Debug payload 必须使用 `version: 1`、`type: "evjs.rsc"`，包含符合 build
identifier 规则的 `buildId`，并提供结构正确的 asset 列表，`loadRscDebugPage()`
才会挂载诊断 HTML。

只有当浏览器需要调用另一个 origin 上的框架服务端时，才配置 `transport.baseUrl`：

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

提供 `transport` 时它必须是 object。提供 `transport.baseUrl` 时，它必须是
absolute HTTP(S) URL，且不能包含首尾空白字符。

启用 framework server 时，用户配置的 `dev.proxy` 规则会排在框架代理之前。每条规则都
必须是 object，包含非空的 `context` pathname pattern 数组，以及作为 absolute
HTTP(S) URL 的 `target`；`null` 和 array entry 会被拒绝。Context pattern 必须以
`/` 开头，不能包含空白字符、query string 或 hash，并且同一条规则内不能重复。Target
不能包含首尾空白字符。可选的 `changeOrigin` 和 `secure` 必须是布尔值。

## 插件

```ts
export default defineConfig({
  plugins: [
    {
      name: "build-timer",
      setup() {
        const start = Date.now();
        return {
          buildEnd({ output }) {
            console.log("Build", output.buildId, Date.now() - start);
          },
        };
      },
    },
  ],
});
```

`plugins` 必须是 plugin object 数组。每个 plugin 都需要非空 `name`，且不能包含首尾空白。
提供 `dependencies` 或 `optionalDependencies` 时，它们必须是非空 plugin name 数组；
`enforce` 必须是 `pre`、`normal` 或 `post`。Plugin object 只接受 `name`、
`dependencies`、`optionalDependencies`、`enforce`、`config` 和 `setup`。

更多 hook 签名、单 HTML 文档上下文和 bundler 辅助函数见 [插件指南](./plugins.md)。

## Bundler

CLI 默认使用 Utoopack。也可以显式传入 adapter：

```ts
import { defineConfig } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

export default defineConfig({
  bundler: utoopackAdapter,
});
```

`bundler` 必须是 adapter object，并且包含非空 `name` 以及 `build` / `dev`
函数，且只接受这三个 key。`null`、array、未知 key 和不完整的 adapter object 会在
config resolution 阶段被拒绝，不会等到命令启动后才报错。

`@evjs/bundler-webpack` 主要用于框架验证，等待 Utoopack 底层 API 补齐时兜底。
Utoopack 仍是默认运行路径。
