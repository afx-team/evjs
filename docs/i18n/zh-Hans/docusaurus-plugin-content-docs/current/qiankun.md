# Qiankun 插件

`@evjs/plugin-qiankun` 可以把 evjs 单页应用接入
[qiankun](https://github.com/umijs/qiankun)，作为主应用或子应用运行。插件负责包装 SPA
入口、导出 qiankun 生命周期，并把主应用异步加载的路由配置接入 evjs 运行时。

该插件只适用于 qiankun 主应用或子应用，不支持 MPA。

## 安装

```bash
npm install @evjs/plugin-qiankun qiankun
```

## 主应用

使用 `evPluginQiankunMaster()` 配置主应用，并提供路由解析模块：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

解析模块返回应用的 `apps/routes` 配置：

```ts
// src/qiankun.master.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => ({
  apps: [
    {
      name: "catalog",
      entry: "//localhost:3001/index.html",
      props: {
        locale: "zh-CN",
      },
    },
    {
      name: "reports",
      entry: "//localhost:3002/index.html",
    },
  ],
  routes: [
    {
      path: "/catalog",
      microApp: "catalog",
      microAppProps: {
        section: "products",
      },
    },
    {
      path: "/reports",
      microApp: "reports",
      mode: "match",
    },
    {
      path: "/legacy-catalog",
      redirect: "/catalog",
    },
  ],
  history: "browser",
  settings: {
    sandbox: true,
  },
  prefetch: ["catalog"],
}));
```

主应用不声明固定的 qiankun 容器或 `activeRule`。框架开始渲染前，插件会解析配置
并注册动态路由。每条微应用路由都会渲染一个 React 组件；该组件创建自己的容器，
并调用 qiankun `loadMicroApp()`。

路由支持以下写法：

- `{ path, microApp }` 默认使用 `"prepend"` 模式。因此 `/catalog` 会匹配自身及其后代，
  匹配前缀会成为已挂载子应用的基础路径。
- `{ path, microApp, mode: "match" }` 只匹配当前路径，不把路径追加到子应用基础路径。
- `{ path, redirect }` 创建运行时重定向。目标可以是应用内绝对路径或 `http(s)` URL。
- `microAppProps` 增加路由专属属性。普通字段会覆盖 `app.props` 中的同名字段；嵌套的
  `settings` 可以调整 qiankun 加载设置，`lifeCycles` 会在主应用对应生命周期之后执行。

解析模块中的路由路径支持 `:param` 与 `*` 语法。插件会把它们转换为 evjs 运行时
路由，并在主应用渲染前拒绝重复、非法或无法解析的配置。

主应用源码树只需要自身的外壳页面：

```text
src/
├── pages/
│   ├── layout.tsx
│   └── page.tsx           # /
└── qiankun.master.ts
```

这里不需要创建 `src/pages/catalog/page.tsx`，也不需要放置静态
`#slave-container`。`/catalog` 对应的运行时组件会同时创建页面内容和挂载容器：

```tsx
// src/pages/layout.tsx
import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav>
        <Link to="/">Home</Link>
        <a href="/catalog">Catalog</a>
      </nav>
      {children}
    </main>
  );
}
```

### 动态路由的能力边界

解析模块提供的路由属于运行时状态，不是文件页面树的一部分：

- 它们不会创建文件页面、构建期路由或 HTML 文档；
- 它们不会修改 `application.routes`、构建计划或部署路由元数据；
- 它们不会进入 `src/route-types.d.ts` 中的页面名称、`RoutePath` 或类型化导航目标；
- 它们通过生成应用的运行时更新 API 注册，并且早于首次渲染。

类型化导航只覆盖文件页面。若 URL 仅存在于运行时配置，它的可用性与校验由平台层
负责；因此上面的 `/catalog` 示例使用普通链接。

## 子应用

子应用会导出 qiankun 生命周期，同时保持可独立渲染。使用
`evPluginQiankunSlave()` 配置：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
```

子应用只声明自己的根页面和内部页面：

```text
src/
├── pages/
│   ├── page.tsx             # 本地 /
│   └── details/
│       └── page.tsx         # 本地 /details
└── qiankun.slave.ts
```

它不会在源码树中重复主应用的 `/catalog` 路径。当主应用在 `/catalog` 配置默认的
`"prepend"` 模式时，会把 `/catalog` 作为子应用基础路径传入。子应用的本地 `/`
会渲染在 `/catalog`，本地 `/details` 会渲染在 `/catalog/details`。

子应用生命周期会加载框架生成的入口，通过 `pagesApp.updateRuntime()` 设置收到的
`base` 与 `history`，然后才首次调用入口的 `start()`。页面应用会等这些运行时参数
就绪后再创建路由器，因此第一个路由器会直接使用挂载后的基础路径与历史记录，而不是
创建后再修改。在 qiankun 外直接运行时，同一组页面使用应用配置的基础路径。

已挂载的子应用后续收到不同的基础路径、历史记录或动态路由时，页面应用会复用现有
Query Client 创建并加载新的路由器。只有新路由器就绪后才会切换渲染内容；加载失败时，
当前路由器会继续生效。此过程只使用 TanStack Router 公开的创建与加载 API，不依赖其
内部状态。

使用浏览器或哈希历史记录挂载时，子应用会使用作用域隔离的历史记录适配器。子应用内的
`Link` 与 `useNavigate()` 仍会更新共享的浏览器 URL，浏览器原生前进和回退也会同时
更新主应用与子应用路由器，但子应用不会替换主应用全局的
`history.pushState` 或 `history.replaceState` 方法。适配器会在卸载时释放。
内存历史记录仍保持隔离，不会写入浏览器 URL。

业务布局不需要再监听 `popstate`、比较 `window.location` 与 `useLocation()`，
也不需要渲染用于纠正状态的 `Navigate`。作用域历史记录适配器是唯一的同步入口，因此
浏览器原生前进和回退仍会遵守 Router 导航拦截，并由 qiankun 的挂载和卸载生命周期
统一管理。
已挂载的主应用主动修改 URL 且不产生 `popstate` 时，路由组件会通过 qiankun 的更新
生命周期转发地址变化。子应用仅在浏览器 URL 与 Router 历史记录不一致时刷新适配器。

生成的路由类型始终描述子应用本地源码树：其中是 `/` 与 `/details`，而不是
外部分配的 `/catalog` 前缀。

可选的运行时模块只增加生命周期行为，不会替换框架入口：

```ts
// src/qiankun.slave.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props, ctx) {
    console.log(`${ctx.name} preparing to mount`, {
      container: props.container,
      base: props.base,
      history: props.history,
    });
  },
  afterMount(_props, ctx) {
    console.log(`${ctx.name} mounted`);
  },
  afterUpdate(_props, ctx) {
    console.log(`${ctx.name} updated`);
  },
  unmount() {
    console.log("slave unmounted");
  },
});
```

在 qiankun 模式下，插件挂载到 `props.container`；在 qiankun 外则直接启动同一个
SPA 入口。它不会自动发现 `src/main.tsx`，也不会提供第二套应用入口。子应用代码必须
使用传入的容器；插件不会改写全局 `document` 查询方法。

## 模块引用

`resolver` 与 `runtime` 支持模块路径、生成的模块引用，以及选择命名导出的对象：

```ts
import type { GeneratedModuleRef } from "@evjs/ev/plugin";

type QiankunModuleRef =
  | string
  | GeneratedModuleRef
  | {
      module: string | GeneratedModuleRef;
      exportName?: string;
    };
```

字符串引用读取默认导出：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
});
```

对象引用选择命名导出：

```ts
evPluginQiankunSlave({
  runtime: {
    module: "/absolute/path/to/generated-slave-runtime.ts",
    exportName: "runtime",
  },
});
```

文件路径会先基于项目根目录解析，再进入构建；包名则从项目依赖中解析。在另一个插件的
`emitIR()` 钩子中，可以把 `ctx.emit.module()` 返回的 `GeneratedModuleRef` 直接传给
`emitQiankunMasterIR()` 或
`emitQiankunSlaveIR()`。

## 运行时类型

主应用公开的类型如下：

```ts
type QiankunHistoryType = "browser" | "hash" | "memory";
type QiankunRouteMode = "prepend" | "match";
type QiankunLoadSettings = import("qiankun").AppConfiguration;
type QiankunLifeCycles = import("qiankun").LifeCycles<
  Record<string, unknown>
>;

interface QiankunApp {
  name: string;
  entry: string;
  props?: Record<string, unknown> & {
    settings?: QiankunLoadSettings;
  };
}

type QiankunRoute =
  | {
      path: string;
      microApp: string;
      mode?: QiankunRouteMode;
      microAppProps?: Record<string, unknown> & {
        settings?: QiankunLoadSettings;
        lifeCycles?: QiankunLifeCycles;
      };
    }
  | {
      path: string;
      redirect: string;
    };

interface QiankunMasterOptions {
  apps?: QiankunApp[];
  routes?: QiankunRoute[];
  base?: string;
  history?: QiankunHistoryType;
  settings?: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
  prefetch?: boolean | "all" | string[];
  prefetchThreshold?: number;
}
```

`base` 默认为 `/`，`history` 默认为 `"browser"`，未设置的 `mode` 默认为
`"prepend"`。`settings` 由通过路由挂载的应用共享，应用和路由中的 `settings` 会依次
覆盖它；路由生命周期钩子会在主应用对应的生命周期钩子之后执行。公共桥接层不会附加
请求策略，也不会解释平台私有字段。

`prefetch: "all"` 在主应用启动后预取全部应用，字符串数组按名称预取指定应用。
`prefetch: true` 会等首个应用挂载后，再预取最多 `prefetchThreshold` 个其他应用；
该值默认为 `5`。

`route.microApp` 必须与 `app.name` 完全匹配。上层集成需要先把外部数据整理为受支持的
`{ name, entry }` 结构，再返回配置。主应用、应用或路由结构中的未知字段
会直接报错而不是被忽略；需要透传的集成数据应放在 `props` 或
`microAppProps` 中。

主应用通过子应用生命周期参数传递由路由计算的值：

```ts
interface QiankunLifecycleProps {
  container?: Element | string | null;
  base?: string;
  history?:
    | QiankunHistoryType
    | { type: "browser" }
    | { type: "hash" }
    | {
        type: "memory";
        initialEntries?: string[];
        initialIndex?: number;
      };
  [key: string]: unknown;
}
```

可选的子应用运行时支持：

```ts
interface QiankunSlaveRuntime {
  bootstrap?(props, ctx): void | Promise<void>;
  mount?(props, ctx): void | Promise<void>;
  afterMount?(props, ctx): void | Promise<void>;
  update?(props, ctx): void | Promise<void>;
  afterUpdate?(props, ctx): void | Promise<void>;
  unmount?(props, ctx): void | Promise<void>;
}
```

`ctx.loadEntry()` 会加载框架生成的入口，但不会启动它，可以在 `bootstrap()` 中安全
调用。首次 `mount()` 会先配置运行时基础路径和历史记录，再调用 `start()`；后续重新
挂载会复用已加载模块，并在当前容器中执行渲染。

`mount()` 和 `update()` 在框架入口开始工作前运行。只有基础路径、历史记录以及入口的
`start()` 或 `render()` 成功完成后，才会调用 `afterMount()`。运行时参数更新成功后会
调用 `afterUpdate()`；即使参数没有变化，已挂载应用收到更新时也会调用它。所有
生命周期操作会按顺序执行：排队的更新或卸载会等待前一个后置生命周期完成。
`afterMount()` 失败会触发挂载回滚；`afterUpdate()` 失败会使本次更新失败，但不会
回滚已经生效的运行时参数。

## 打包 qiankun

默认情况下，qiankun 会打包到应用产物中：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
  externalQiankun: false,
});
```

仅在运行环境已经提供 qiankun 时设置 `externalQiankun: true`：

```ts
evPluginQiankunSlave({
  name: "catalog",
  externalQiankun: true,
});
```

## 本地开发

插件不会自动创建开发代理。如果主应用需要通过同源地址加载子应用开发服务器，请配置
`dev.proxy`：

```ts
// 主应用 ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  dev: {
    port: 3000,
    proxy: [
      {
        context: ["/__qiankun_slave"],
        target: "http://localhost:3001",
        pathRewrite: {
          "^/__qiankun_slave": "",
        },
        changeOrigin: true,
        secure: false,
      },
    ],
  },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

将解析配置中的应用入口指向代理后的 HTML。qiankun 3 使用 HTML 入口 URL，而不是
`{ scripts, styles, html }` 对象：

```ts
const slaveBase = "/__qiankun_slave";

export default async function resolveQiankunMaster() {
  return {
    apps: [
      {
        name: "catalog",
        entry: new URL(`${slaveBase}/index.html`, window.location.href).href,
      },
    ],
    routes: [{ path: "/catalog", microApp: "catalog" }],
    settings: { sandbox: true },
    prefetch: true,
  };
}
```

`evPluginQiankunSlave()` 会标记生成的入口脚本，并把根路径形式的 JS/CSS URL 改写为
相对 URL，因此同一份子应用 HTML 可以在不同代理前缀下加载。微前端静态资源代理应
放在 `dev.proxy`，而不是 `src/apis`；应用 API 路由不应代理微前端静态资源。

## 集成到上层平台

上层集成插件可以在 `emitIR()` 中复用 `emitQiankunMasterIR()` 或
`emitQiankunSlaveIR()`，并在 `setup()` 中复用对应的
`createQiankun*Hooks()` 辅助函数。它必须先整理外部数据，再把解析模块或运行时模块传给
公共桥接层；若自身还有生命周期行为，则需与辅助函数返回的钩子组合。

应用应在公共主应用或子应用插件工厂与上层集成插件工厂之间二选一，不要同时安装。
平台私有配置也不属于页面配置。

## 能力边界

`@evjs/plugin-qiankun` 提供：

- 主应用与子应用的框架入口包装；
- 解析模块与运行时模块加载；
- 应用级 `apps/routes` 校验；
- `prepend`、`match`、重定向和微应用动态路由组件；
- 微应用挂载容器与 qiankun 加载；
- 首次渲染前设置子应用的基础路径与历史记录；
- 子应用生命周期导出，以及在 qiankun 外直接渲染；
- `externalQiankun` 支持；
- 供上层平台复用的扩展能力和生命周期辅助函数。

它不包含：

- 外部平台数据协议或身份映射；
- 平台私有的运行时、部署或开发策略；
- 自动创建本地开发代理；
- 页面级 qiankun 配置；
- 根据解析配置创建文件页面、构建期路由或 HTML 文档；
- 为动态路由生成 `RoutePath` 类型。
