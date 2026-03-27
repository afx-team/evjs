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
| `client.entry` | `./src/main.tsx` |
| `client.html` | `./index.html` |
| `client.dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.functions.endpoint` | `/api/fn` |

## 完整参考

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    entry: "./src/main.tsx",
    html: "./index.html",
    plugins: [
      {
        name: "tailwind",
        module: {
          rules: [
            { test: /\.css$/, use: ["style-loader", "css-loader", "postcss-loader"] },
          ],
        },
      },
    ],
    dev: {
      port: 3000,
      https: false,
    },
  },
  server: {
    entry: "./src/server.ts",
    backend: "node",
    functions: {
      endpoint: "/api/fn",
    },
    plugins: [],
    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

## 客户端选项

### `client.plugins`

`EvPlugin` 对象数组，用于通过自定义模块规则扩展构建管道：

```ts
interface EvPlugin {
  name: string;
  module?: { rules?: EvModuleRule[] };
}

interface EvModuleRule {
  test: RegExp;
  exclude?: RegExp;
  use: EvLoaderEntry | EvLoaderEntry[];
}
```

#### 插件示例

```ts
// Tailwind CSS
{ name: "tailwind", module: { rules: [{
  test: /\.css$/,
  use: ["style-loader", "css-loader", "postcss-loader"],
}]}}

// CSS Modules
{ name: "css-modules", module: { rules: [{
  test: /\.module\.css$/,
  use: [
    "style-loader",
    { loader: "css-loader", options: { modules: true } },
  ],
}]}}

// SVG
{ name: "svg", module: { rules: [{
  test: /\.svg$/,
  exclude: /node_modules/,
  use: "@svgr/webpack",
}]}}
```

## 服务端选项

### `server.backend`

| 值 | 行为 |
|----|------|
| `"node"`（默认） | 在开发模式使用 `--watch` 自动重启 |
| `"bun"` | 直接传递参数 |
| `"deno run --allow-net"` | 空格分割，额外参数转发 |

:::warning

ECMA 适配器（`@evjs/server/ecma`）只导出一个 `{ fetch }` 处理器 —— 它**不会**启动监听服务器。在 `ev dev` 中，始终使用 `"node"` 作为后端。

:::
