# 配置

应用级选择放在 `ev.config.ts`。页面专属的元信息、渲染和插件选项放在相邻 `page.config.ts`。

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
});
```

推荐使用 TypeScript 配置，以获得字段补全和页面插件类型。

## 顶层选项

| 选项 | 用途 | 默认值 |
| --- | --- | --- |
| `routing` | 启用文件页面并选择 SPA 或 MPA | 声明后才启用 |
| `conventions` | 启用全部框架文件约定 | `true` |
| `dev` | 浏览器开发服务器 | 端口 `3000` |
| `server` | 服务端运行时、构建解析与开发服务器 | 基础路径 `/__evjs`，开发端口 `3001` |
| `transport` | 浏览器到服务端的来源 | 同源 |
| `target` | 生产 Android 与 iOS 兼容目标 | 构建器默认值 |
| `polyfill` | 已启用目标的外部 core-js 来源 | 打包 core-js |
| `output` | 浏览器/服务端目录与资源 CORS 策略 | `dist/client`、`dist/server` |
| `plugins` | 安装并配置集成 | `[]` |
| `bundler` | 选择非默认构建器适配器 | CLI 使用 Utoopack |
| `application` | 程序化 SPA 路由树 | 未设置 |

## 路由

声明 `routing` 会启用 `src/pages/**/page.*` 文件页面树：

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    html: "./index.html",
    mount: "#app",
  },
});
```

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `mode` | `"spa" \| "mpa"` | 必填的导航/文档模型 |
| `html` | `string` | 共享 HTML 模板，默认 `./index.html` |
| `mount` | `string` | React 挂载选择器，默认 `#app` |

页面根目录固定为 `src/pages`。SPA 与 MPA 读取相同页面文件，能力差异见[页面与路由](./client-routes)。

## 页面配置

可选的 `page.config.ts` 放在对应 `page.*` 文件旁：

```ts title="src/pages/profile/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Profile",
  meta: {
    description: "View and update your profile.",
  },
  render: "ssr",
  hydrate: "load",
  plugins: {
    analytics: { channel: "profile" },
  },
});
```

| 字段 | 用途 |
| --- | --- |
| `title` | 页面的静态文档标题 |
| `meta` | 输出为命名 `<meta>` 的字符串映射 |
| `render` | `"csr"`、`"ssr"` 或 `"ssg"` |
| `hydrate` | 显式 SSR/SSG 页面的 `"load"` 或 `"none"` |
| `prerender` | 静态或部分预渲染选项 |
| `rsc` | 为 SSR 页面启用 RSC |
| `document.aliases` | 页面静态文档额外的 `.html` 或 `.htm` 输出路径 |
| `plugins` | 按已安装插件 id 保存的静态页面选项 |

默认导出必须是静态 JSON 数据。有效渲染组合见[渲染](./rendering)，插件作用域见[使用插件](./plugins)。

## 开发服务器

```ts
export default defineConfig({
  dev: {
    port: 4000,
    https: false,
    cliShortcuts: true,
    proxy: [
      {
        context: ["/backend"],
        target: "http://localhost:8080",
        pathRewrite: { "^/backend": "" },
        changeOrigin: true,
        secure: true,
      },
    ],
  },
  server: {
    dev: {
      port: 4001,
      https: false,
    },
  },
});
```

### `dev`

| 字段 | 类型 | 默认值 |
| --- | --- | --- |
| `port` | `number` | `3000` |
| `https` | `boolean \| { key, cert }` | `false` |
| `proxy` | `DevProxyRule[]` | `[]` |
| `cliShortcuts` | `boolean` | `true` |

代理规则支持 `context`、`target`，以及可选 `pathRewrite`、`changeOrigin` 和 `secure`。默认 Utoopack 适配器支持布尔形式的客户端 HTTPS；需要自定义客户端证书时选择 Webpack 适配器。

### `server.dev`

| 字段 | 类型 | 默认值 |
| --- | --- | --- |
| `port` | `number` | `3001` |
| `https` | `false \| { key, cert }` | `false` |

服务端 HTTPS 必须提供明确的 key/cert 对。URL、端口回退和重启行为见[本地开发](./dev)。

## 服务端

```ts
export default defineConfig({
  server: {
    basePath: "/__evjs",
    rsc: {
      endpoint: "/__evjs/rsc",
    },
    resolve: {
      alias: {
        "server-sdk": "./src/server/sdk.ts",
      },
    },
    externals: {
      "native-addon": "commonjs native-addon",
    },
  },
});
```

| 字段 | 用途 |
| --- | --- |
| `basePath` | 服务端函数、PPR 和 RSC 端点使用的前缀 |
| `rsc.endpoint` | 覆盖 RSC Flight 端点，本身不启用 RSC |
| `resolve.alias` | 仅服务端构建入口使用的模块别名 |
| `externals` | 仅服务端构建入口使用的外部模块请求 |
| `dev` | 服务端开发端口与 HTTPS |

`basePath` 默认 `/__evjs`。除非主机或反向代理占用它，否则保持默认。运行时路径必须是绝对静态 URL 路径，不能包含动态段、通配符、百分号转义或 `.`/`..` 段。

RSC 在页面 `page.config.ts` 中启用，而不是通过 `server.rsc`。

## 浏览器兼容性

同时设置两个最低平台以启用生产语法降级和 core-js：

```ts
export default defineConfig({
  target: {
    android: 6,
    ios: 10,
  },
});
```

最低接受 Android 5 和 iOS 8，两个字段都必填。这只改变生产客户端产物，不改变 Node.js 或服务端编译。

默认情况下，目标客户端入口会打包 `core-js/stable`。若改用外部 UMD 文件，请提供绝对 HTTP(S) URL：

```ts
export default defineConfig({
  target: { android: 6, ios: 10 },
  polyfill: {
    coreJs: "https://cdn.example.com/core-js-bundle.min.js",
  },
});
```

`polyfill` 只有与 `target` 一起才有效。它覆盖 ECMAScript 内建能力，不包含 `fetch`、`AbortController` 或 Streams 等 Web API。

## 输出

```ts
export default defineConfig({
  output: {
    client: "dist/public",
    server: "dist/runtime",
    crossOriginLoading: "anonymous",
  },
});
```

| 字段 | 类型 | 默认值 |
| --- | --- | --- |
| `client` | 项目相对路径 | `dist/client` |
| `server` | 项目相对路径 | `dist/server` |
| `crossOriginLoading` | `false \| "anonymous" \| "use-credentials"` | `"anonymous"` |

客户端和服务端目录必须是 `dist` 下分离且不嵌套的后代，不能包含空、`.` 或 `..` 路径段。

`crossOriginLoading` 设置生成 JavaScript/CSS 标签的 `crossorigin` 属性，并对动态代码块加载应用相同策略。

## 跨域服务端传输

同源应用无需传输配置。浏览器代码必须调用另一个源的 evjs 服务端时，设置绝对 URL：

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

它影响服务端函数等框架发起的浏览器到服务端调用，不是通用 API 客户端的基础 URL。

## 插件

通过工厂函数安装插件：

```ts
import { analytics } from "@company/evjs-plugin-analytics";

export default defineConfig({
  plugins: [
    analytics({
      endpoint: "/events",
      debug: false,
    }),
  ],
});
```

工厂函数参数是插件的应用级配置。条件项可使用 `false`、`null` 或 `undefined`。支持页面配置的插件会在 `page.config.ts#plugins` 中以自身 id 提供页面配置契约。

应用选项与页面选项是独立契约，不会相互合并。详见[使用插件](./plugins)。

## 构建器

CLI 默认选择 Utoopack。只有应用需要另一适配器提供的能力或验证路径时才显式传入：

```ts
import { webpackAdapter } from "@evjs/bundler-webpack";

export default defineConfig({
  routing: { mode: "spa" },
  bundler: webpackAdapter,
});
```

改变构建器后运行 `ev inspect`，它会报告应用渲染选择需要的能力。

## 关闭文件约定

自行管理路由与运行时的应用可以一起关闭页面、API 路由和中间件文件发现：

```ts
export default defineConfig({
  conventions: false,
});
```

没有逐目录开关。`conventions: false` 不能与 `routing` 组合；被应用引用的 `"use server"` 模块和显式 `application.routes` 仍可用。

显式 SPA 路由树 API 见[自定义路由与运行时](./advanced-conventions)。
