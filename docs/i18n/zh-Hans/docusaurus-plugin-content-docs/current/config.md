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

## 插件

插件使用 `setup()` 函数，接收已解析的配置并返回生命周期钩子：

### `setup(ctx)`

初始化插件并返回生命周期钩子。上下文提供 `mode`（`"development"` | `"production"`）和完整解析后的 `config`。

```ts
{
  name: "my-plugin",
  setup(ctx) {
    return {
      buildStart() { /* 编译前 */ },
      bundler(config) { /* 修改构建器配置 */ },
      buildEnd(result) { /* 编译后，接收 manifest */ },
    };
  },
}
```

### 生命周期钩子

| 钩子 | 签名 | 时机 |
|------|------|------|
| `buildStart` | `() => void` | 编译开始前 |
| `bundler` | `(config: unknown, ctx: EvBundlerCtx) => void` | 构建器配置创建期间 |
| `buildEnd` | `(result: EvBuildResult) => void` | 编译后（开发模式每次重编译都触发） |

### 类型安全的构建器配置

使用 `@evjs/bundler-webpack` 导出的 `webpack()` 辅助函数获得完整类型安全：

```ts
import { webpack } from "@evjs/bundler-webpack";

{
  name: "mdx-support",
  setup() {
    return {
      bundler: webpack((config) => {
        config.module?.rules?.push({
          test: /\.mdx$/,
          use: ["mdx-loader"],
        });
      }),
    };
  },
}
```

上下文类型：
- `EvPluginContext`: `{ mode: "development" | "production", config: ResolvedEvConfig }`
- `EvBundlerCtx`: `{ mode: "development" | "production", config: ResolvedEvConfig }`
- `EvBuildResult`: `{ clientManifest: ClientManifest, serverManifest?: ServerManifest, isRebuild: boolean }`

## 构建器选项

`bundler` 字段选择编译引擎。

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `name` | `"webpack"` | `"webpack"` | 激活的构建器适配器。未来计划：`"utoopack"` |

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
import { webpack } from "@evjs/bundler-webpack";

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
          bundler: webpack((config) => {
            config.module?.rules?.push({
              test: /\.mdx$/,
              use: ["mdx-loader"],
            });
          }),
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

