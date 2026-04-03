# 构建

## 命令

```bash
ev build
```

设置 `NODE_ENV=production` 并生成优化的 bundle。

## 输出结构

```
dist/
├── client/
│   ├── manifest.json       # 客户端资源映射 + 路由元数据
│   ├── index.html          # 生成的 HTML
│   ├── main.[hash].js      # 客户端 bundle
│   └── [chunk].[hash].js   # 代码分割的块
└── server/
    ├── manifest.json       # 服务端函数注册表
    └── main.[hash].js      # 服务端函数 bundle（CJS）
```

## 服务端函数转换

带有 `"use server"` 的文件会通过双重转换自动处理：

| 端 | 处理方式 |
|----|---------|
| **客户端** | 函数体被替换为 `__fn_call(fnId, args)` RPC 桩代码 |
| **服务端** | 原始函数体保留 + 注入 `registerServerFn(fnId, fn)` |

函数 ID 是基于 `文件路径 + 导出名称` 的稳定 SHA-256 哈希。

## 要点

- 使用基于约定的默认值即可开箱即用
- 客户端 bundle 使用内容哈希文件名实现缓存失效
- 服务端 bundle 将 `node_modules` 外部化（`@evjs/*` 包除外）
- 无临时配置文件 —— webpack 通过 Node API 驱动
