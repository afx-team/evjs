# 配置

evjs **默认零配置**。你可以选择在项目根目录创建 `ev.config.ts` 来覆盖默认值。`defineConfig` 辅助函数提供完整的类型安全。

```ts
import { defineConfig } from "@evjs/ev";
export default defineConfig({ /* ... */ });
```

## 默认值

所有字段都是可选的，以下是内置默认值：

| 设置 | 默认值 |
|------|--------|
| `assetPrefix` | `"/"` |
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `dev.port` | `3000` |
| `server.runtime` | `"node"` |
| `server.dev.port` | `3001` |
| `server.endpoint` | `/api/fn` |

## 完整参考

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  assetPrefix: "/",
  entry: "./src/main.tsx",
  html: "./index.html",
  dev: {
    port: 3000,
    https: false,
  },
  // 设置为 `false` 可禁用服务端（纯 CSR 模式，扁平 dist/ 输出）
  // server: false,
  server: {
    entry: "./src/server.ts",
    runtime: "node",
    endpoint: "/api/fn",
    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

## 客户端选项

### `assetPrefix`

所有客户端资源的 URL 前缀。在将静态文件（JS/CSS/图片）部署到不同域名的 CDN 时使用。

在开发模式下，该字段会被忽略以确保局部热更新（HMR）。在生产模式下，此前缀会自动注入到 Webpack 分块查找、HTML script 标签中，并且作为 `window.assetPrefix` 运行时变量导出。

## 插件

通过 `plugins` 数组注册插件。每个插件包含 `name` 和返回生命周期钩子的 `setup()` 函数：

```ts
export default defineConfig({
  plugins: [
    {
      name: "my-plugin",
      setup(ctx) {
        return {
          buildStart() { /* ... */ },
          bundlerConfig(config, ctx) { /* ... */ },
          transformHtml(doc) { /* ... */ },
          buildEnd(result) { /* ... */ },
        };
      },
    },
  ],
});
```

查看 **[插件指南](./plugins.md)** 获取完整 API 参考、`EvDocument` DOM 接口、类型安全构建器辅助函数和实用示例。

## 构建器选项

`bundler` 字段选择编译引擎。默认情况下，evjs 使用 **utoopack**（`@utoo/pack`）。你可以通过传递 webpack 适配器来切换到 webpack。

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `bundler` | `BundlerAdapter` | utoopack | 激活的构建器适配器。从 `@evjs/bundler-utoopack` 导入 `utoopackAdapter` 以使用 webpack，而不是默认的 utoopack。 |

```ts
import { defineConfig } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

export default defineConfig({
  bundler: utoopackAdapter,  // 使用 webpack 代替默认的 utoopack
});
```

### 内置支持：CSS 和 Tailwind
evjs 包含**内置的 PostCSS/Tailwind 支持**。如果项目根目录检测到 `postcss.config.js` 文件，内部 Webpack 适配器将自动启用 `postcss-loader`。标准 Tailwind 设置无需插件或自定义钩子。

## 服务端选项

`server` 字段接受一个对象用于全栈应用，或设置为 `false` 以完全禁用服务端（纯 CSR 模式）。

```ts
// 纯 CSR：扁平 dist/ 输出，无服务端 bundle
export default defineConfig({ server: false });
```

设置 `server: false` 时：
- 构建输出到 `dist/` 而不是 `dist/client/` + `dist/server/`
- 任何 `"use server"` 模块都会导致**构建错误**
- 开发模式下不配置 API 代理

### `server.runtime`

| 值 | 行为 |
|----|------|
| `"node"`（默认） | 在开发模式使用 `--watch` 自动重启 |
| `"bun"` | 直接传递参数 |
| `"deno run --allow-net"` | 空格分割，额外参数转发 |

:::warning

ECMA 适配器（`@evjs/server/ecma`）只导出一个 `{ fetch }` 处理器 —— 它**不会**启动监听服务器。在 `ev dev` 中，始终使用 `"node"` 作为后端。

:::

## 示例

### 完整示例

此示例展示了一个具备自定义加载器和构建分析的生产就绪设置。

```ts
import { defineConfig } from "@evjs/ev";
import { webpack } from "@evjs/bundler-utoopack";

export default defineConfig({
  entry: "./src/entry-client.tsx",
  server: {
    entry: "./src/entry-server.ts",
    endpoint: "/api/rpc",
    dev: { port: 4001 },
  },

  dev: { port: 4000 },

  plugins: [
    {
      name: "mdx-support",
      setup() {
        return {
          bundlerConfig(config, ctx) {
            webpack((cfg) => {
              cfg.module?.rules?.push({
                test: /\.mdx$/,
                use: ["mdx-loader"],
              });
            })(config, ctx);
          },
        };
      },
    },
    {
      name: "build-timer",
      setup(ctx) {
        const t0 = Date.now();
        return {
          buildStart() {
            console.log(`构建中 (${ctx.mode})...`);
          },
          buildEnd(result) {
            console.log(`完成，耗时 ${Date.now() - t0}ms`);
            console.log(`资源: ${result.clientManifest.assets.js.length} 个 JS 文件`);
          },
        };
      },
    },
  ],
});
```

