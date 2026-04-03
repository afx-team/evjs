# 配置

evjs **默认零配置**。你可以选择在项目根目录创建 `ev.config.ts` 来覆盖默认值。`defineConfig` 辅助函数提供完整的类型安全。

```ts
import { defineConfig } from "@evjs/cli";
export default defineConfig({ /* ... */ });
```

## 默认值

所有字段都是可选的，以下是内置默认值：

| 设置 | 默认值 |
|------|--------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `dev.port` | `3000` |
| `server.runtime` | `"node"` |
| `server.dev.port` | `3001` |
| `server.endpoint` | `/api/fn` |

## 完整参考

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
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

插件提供两个钩子来扩展框架：

### `config(config, ctx)`
修改框架级别的 `EvConfig`。适用于更改端口、入口点或路由端点。

```ts
config(config, ctx) {
  if (ctx.mode === "development") {
    config.dev ??= {};
    config.dev.port = 8080;
  }
}
```

### `bundler(bundlerConfig, ctx)`
修改底层构建器配置（例如 Webpack）。`bundlerConfig` 参数为 `unknown`，因为它取决于当前激活的适配器。`ctx` 包含完整解析后的框架 `config`。

```ts
bundler(bundlerConfig, ctx) {
  const webpackConfig = bundlerConfig as any;
  webpackConfig.module.rules.push({
    test: /\.mdx$/,
    use: ["mdx-loader"]
  });
}
```

上下文类型：
- `EvConfigCtx`: `{ mode: "development" | "production" }`
- `EvBundlerCtx`: `{ mode: "development" | "production", config: ResolvedEvConfig }`

## 构建器选项

`bundler` 字段允许访问底层编译引擎。

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `name` | `"webpack" \| "utoopack"` | `"webpack"` | 激活的构建器适配器 |
| `config` | `(bundlerConfig: unknown, ctx: EvBundlerCtx) => void` | `undefined` | 修改构建器配置的逃生舱 |

### 内置支持：CSS 和 Tailwind
evjs 包含**内置的 PostCSS/Tailwind 支持**。如果项目根目录检测到 `postcss.config.js` 文件，内部 Webpack 适配器将自动启用 `postcss-loader`。标准 Tailwind 设置无需插件或自定义 `bundler` 钩子。

插件可以直接修改配置对象，也可以返回一个新的配置对象。

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

### 有意义的完整示例

此示例展示了一个具备自定义加载器、环境变量和特定入口点的生产就绪设置。

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  // 1. 自定义入口点
  entry: "./src/entry-client.tsx",
  server: {
    entry: "./src/entry-server.ts",
    endpoint: "/api/rpc",
    dev: { port: 4001 },
  },

  dev: { port: 4000 },

  // 2. 专业插件
  plugins: [
    {
      name: "mdx-support",
      bundler(bundlerConfig, ctx) {
        // 仅为 Webpack 添加 MDX 支持
        if (ctx.config.bundler.name === "webpack") {
          const webpackConfig = bundlerConfig as any;
          webpackConfig.module.rules.push({
            test: /\.mdx$/,
            use: ["mdx-loader"],
          });
        }
      },
    },
  ],

  // 3. 直接构建器逃生舱
  bundler: {
    config(bundlerConfig, ctx) {
      // 通过 Webpack 注入全局环境变量
      if (ctx.config.bundler.name === "webpack") {
        const webpack = require("webpack");
        const webpackConfig = bundlerConfig as any;
        webpackConfig.plugins.push(
          new webpack.DefinePlugin({
            __VERSION__: JSON.stringify("1.2.3"),
          })
        );
      }
    },
  },
});
```

