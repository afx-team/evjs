# 贡献指南

> evjs 单仓库的内部开发指南。

## 项目信息

- **名称**：evjs（元框架），`@evjs/*`（包范围）
- **仓库**：[evaijs/evjs](https://github.com/evaijs/evjs)
- **CLI 命令**：`ev`（来自 `@evjs/cli` 的二进制文件）
- **Linter**：Biome（`npx biome check --write`）
- **模块类型**：仅 ESM（所有包中 `"type": "module"`）

## 设置

```bash
git clone https://github.com/evaijs/evjs.git
cd evjs
npm install
```

## 命令

```bash
npm run build              # 构建所有包 + 示例
npm run test               # 单元测试（vitest）
npm run test:e2e           # E2E 测试（playwright）
npm run dev                # 开发模式（turborepo）
npx biome check --write    # 修复 lint/格式
```

## 编码规则

1. **导入** —— 所有导入放在文件顶部。类型导入使用 `import type`
2. **Lint** —— Biome 强制执行；禁止 `any`，禁止 `import * as`（除非必要）
3. **服务端函数** —— 必须以 `"use server";` 开头，使用 `.server.ts` 或 `src/api/`
4. **配置文件** —— 命名为 `ev.config.ts`（不是 `evjs.config.ts`）

## 发布新版本

1. 创建一个带有标签（如 `v0.1.0`）的 GitHub Release
2. 发布工作流自动同步版本并发布到 npm
3. **不要在本地修改版本号** —— 代码库对内部依赖使用 `"*"`
