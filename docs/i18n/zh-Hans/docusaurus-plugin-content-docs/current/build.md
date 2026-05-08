# 构建

## 命令

```bash
ev build
```

设置 `NODE_ENV=production` 并生成优化的 bundle。

## 输出结构

### 全栈（默认）

```
dist/
├── client/
│   ├── manifest.json       # 客户端资源映射 + 路由元数据
│   ├── index.html          # 生成的 HTML
│   ├── main.[hash].js      # 客户端 bundle
│   └── [chunk].[hash].js   # 代码分割的块
└── server/
    ├── manifest.json       # 服务端资源映射 + 函数和路由注册表
    └── main.[hash].js      # 服务端函数 bundle（CJS）
```

### 纯 CSR（`server: false`）

在 `ev.config.ts` 中设置 `server: false` 时，输出为扁平结构：

```
dist/
├── manifest.json         # 客户端资源映射 + 路由元数据
├── index.html            # 生成的 HTML
├── main.[hash].js        # 客户端 bundle
└── [chunk].[hash].js     # 代码分割的块
```

> **注意：** 设置 `server: false` 后，任何 `"use server"` 模块都会导致构建错误。

## 服务端函数转换

带有 `"use server"` 的文件会通过双重转换自动处理：

| 端 | 处理方式 |
|----|---------|
| **客户端** | 函数体被替换为 `createServerReference()` RPC 桩代码 |
| **服务端** | 原始函数体保留 + 注入 `registerServerReference()` |

函数 ID 由服务端函数转换生成，并同时写入客户端桩代码和服务端 `registerServerReference()` 调用。Utoopack 构建完成后，manifest 生成器会从已输出的服务端 bundle 中读取这些 ID，不会再次基于源码重新哈希。

## 构建流程

1. `loadConfig(cwd)` —— 加载 `ev.config.ts` 或基于约定的默认配置
2. `BundlerAdapter.build()` —— 生成 bundler 配置并执行编译
3. 当前 bundler adapter 在编译期间执行：
   - 发现 `*.server.ts` 文件
   - 应用 SWC 转换（客户端 + 服务端两种变体）
   - 生成路由 marker 模块，并通过生成的入口包装模块引入它们
   - 运行服务端 bundle 编译
   - 从服务端 bundle 的 `registerServerReference()` 调用收集函数 ID
   - 从已输出的路由 marker 调用收集客户端路由和服务端路由元数据
   - 输出 `dist/server/manifest.json`（服务端资源映射、函数和路由注册表）以及 `dist/client/manifest.json`（客户端资源映射 + 客户端路由）

## 服务端 Manifest（`dist/server/manifest.json`）

包含服务端 bundle 资源、服务端函数 ID 以及服务端路由资源映射：

```json
{
  "version": 1,
  "entry": "main.a1b2c3d4.js",
  "assets": {
    "js": ["main.a1b2c3d4.js"],
    "css": []
  },
  "fns": {
    "a1b2c3d4": {
      "assets": {
        "js": ["main.a1b2c3d4.js"],
        "css": []
      }
    }
  },
  "routes": [
    {
      "path": "/api/users",
      "methods": ["GET", "POST"],
      "assets": {
        "js": ["main.a1b2c3d4.js"],
        "css": []
      }
    }
  ]
}
```

## 客户端 Manifest（`dist/client/manifest.json`）

包含客户端构建元数据：

```json
{
  "version": 1,
  "assets": { "js": ["main.abc123.js"], "css": ["styles.def456.css"] },
  "routes": [{ "path": "/" }, { "path": "/users" }, { "path": "/posts/$postId" }]
}
```

## 要点

- 使用基于约定的默认值即可开箱即用
- 客户端 bundle 使用内容哈希文件名实现缓存失效
- 服务端 bundle 将 `node_modules` 外部化（`@evjs/*` 包除外）
- 无临时配置文件 —— webpack 通过 Node API 驱动
