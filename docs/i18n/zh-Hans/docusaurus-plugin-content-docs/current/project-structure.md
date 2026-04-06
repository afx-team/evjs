# 项目目录结构

在使用 `evjs` 构建应用程序时，我们推荐采用一种受 FSD（Feature-Sliced Design）启发的现代化、可扩展的全栈目录结构。这种约定将前端组件与纯服务端边界进行了清晰的隔离，并在项目规模逐步庞大时，倡导按业务领域（而非技术类型）来组织代码。

## 推荐的目录规范

```text
my-evjs-app/
├── ev.config.ts           # evjs 框架配置文件
├── package.json
├── tsconfig.json
├── public/                # 静态资源目录（图片、字体、favicon 等）
└── src/
    ├── main.tsx           # 入口文件：构建路由树、createApp、注册类型
    │
    ├── pages/             # (核心) TanStack Router 代码式路由
    │   ├── __root.tsx     # 根路由布局 (Root Layout) 包裹所有页面
    │   ├── home.tsx       # 静态路由 (如 `/`)
    │   └── posts/
    │       └── index.tsx  # 嵌套路由 (`/posts`, `/posts/$postId`)
    │
    ├── api/               # (核心) 后端独占逻辑与服务端职能
    │   ├── fns/               # 纯服务端函数 (Server Functions，在构建时自动转换为 RPC)
    │   └── routes/            # [可选] 标准 REST 路由处理器 (由后端的 HTTP Server 接管，比如开放 API/Webhook)
    │
    ├── components/        # 全局可复用的基础 UI 组件 (如 Button, Modal, Layout)
    │
    ├── features/          # [推荐] 按业务功能拆分的模块 (非常适合中大型项目)
    │   └── auth/          # 例如：所有的鉴权逻辑与页面片段都收敛于此
    │       ├── components/# 与 Auth 强绑定的 UI 组件
    │       ├── hooks/     # 与 Auth 强绑定的自定义 Hooks
    │       ├── utils.ts   # 业务逻辑代码
    │       └── types.ts   # 领域特有类型声明
    │
    ├── lib/               # 基础库封装与通用底层工具 (如 Axios 实例配置、日志库等)
    │
    ├── hooks/             # 全局均可引用的 React 业务逻辑 Hooks
    │
    ├── styles/            # 全局样式文件（如 Tailwind 核心入口、CSS 变量声明）
    │
    └── global.ts          # (可选) 全局类型声明和传输初始化
```

## 核心设计考量

### 1. `src/pages/` 是组装车间
路由通过显式的 `createRoute()` 调用定义，并在 `main.tsx` 中通过 `addChildren()` 组装成路由树。我们**非常不提倡**在路由文件里堆砌成百上千行的复杂业务代码。路由文件应该被视为"胶水层"——它负责声明 URL 逻辑、处理页面级参数，然后引入位于 `features/` 或 `components/` 中的子组件进行界面拼装。这样不仅能避免单个文件过大，还能极大提升代码复用性和可测试性。

### 2. 将 `src/api/` 作为不可逾越的服务端边界
虽然基于 `"use server";` 和 `.server.ts` 后缀，服务端函数可以被放在 `src/` 的任何位置，但我们**强烈推荐**将所有与数据库交互、后端鉴权、核心机密逻辑相关的代码彻底收网到 `src/api/` 这个子目录中。这样做能从物理隔离的源头上，防止服务端特有模块误泄漏至纯客户端构建中。

### 3. 引入按功能切分的 `features/` 模式
在中大型 React 应用开发中最常见的灾难就是：平铺的 `components` 渐渐装了几百个文件，到后期根本分不清哪些组件属于哪个业务线。引入 `features/`（业务领域驱动）能将高度耦合（同生共死）的前端资产封装在一个“业务桶”内，这极大地减缓了后续代码的腐化速度。
