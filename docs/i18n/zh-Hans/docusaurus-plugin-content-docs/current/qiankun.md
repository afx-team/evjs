# Qiankun 插件

`@evjs/plugin-qiankun` 让 evjs 单页应用参与
[qiankun](https://github.com/umijs/qiankun) 主/子应用微前端拓扑。它会包装框架持有的
SPA entry、暴露 qiankun lifecycle，并把异步 master 快照桥接为 evjs runtime
routes。

仅当 SPA 明确以 qiankun master 或 slave 身份运行时才使用该插件。它不提供 MPA
集成。

## 安装

```bash
npm install @evjs/plugin-qiankun qiankun
```

## Master 应用

使用 `evPluginQiankunMaster()` 配置 master，并提供 resolver 模块：

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

resolver 返回唯一权威、Application 级的 `apps/routes` 快照：

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

Master 不声明固定 qiankun container 或 `activeRule`。框架开始渲染前，插件会先解析
快照并安装 evjs runtime route overlay。每个微应用 route 都渲染一个生成的 React
组件；该组件自行持有 container，并调用 qiankun `loadMicroApp()`。

Route 支持以下形态：

- `{ path, microApp }` 默认使用 `"prepend"` mode。因此 `/catalog` 同时持有
  `/catalog` 及其后代，匹配到的前缀会成为已挂载 slave 的 base。
- `{ path, microApp, mode: "match" }` 只匹配该 route path，不把 path 追加到
  slave base。
- `{ path, redirect }` 创建 runtime redirect。目标可以是绝对应用路径或
  `http(s)` URL。
- `microAppProps` 增加 route-specific props。普通字段会覆盖 `app.props` 中的
  同名字段；嵌套的 `settings` 可以细化 qiankun load settings，嵌套的
  `lifeCycles` 会在对应的 master lifecycle hooks 之后为该 route 执行。

Resolver route path 支持普通 `:param` 与 `*` 语法。Bridge 会把它们归一化为 evjs
runtime router 形式，并在 master 渲染前拒绝重复、非法或无法解析的 route。

Master 源码树只需要自身的 canonical shell Pages：

```text
src/
├── pages/
│   ├── layout.tsx
│   └── page.tsx           # /
└── qiankun.master.ts
```

这里有意不创建 `src/pages/catalog/page.tsx`，也不放置静态
`#slave-container`。`/catalog` overlay 提供的 runtime component 同时持有这两项
职责：

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

### Runtime overlay 边界

Resolver routes 是 runtime state，不是 canonical CoreGraph 的 authoring input：

- 它们不会创建 canonical Page、Route 或 Document；
- 它们不会修改 `application.routes`、BuildPlan 或部署 route metadata；
- 它们不会进入生成的 `src/route-types.d.ts` Page name、`RoutePath` 或类型化导航
  target；
- 它们通过生成 Application 的 runtime update API 安装，并且早于首次渲染。

Canonical navigation 类型只用于 canonical Page。若 URL 只存在于 runtime site
snapshot，它的可用性与校验属于平台/runtime 层；因此上面的 `/catalog` 示例使用
普通链接。

## Slave 应用

Slave 会导出 qiankun lifecycle，同时保持可独立渲染。使用
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

Slave 只声明自身根 Page 与内部 Page：

```text
src/
├── pages/
│   ├── page.tsx             # 本地 /
│   └── details/
│       └── page.tsx         # 本地 /details
└── qiankun.slave.ts
```

它不会在源码树中重复 master 的 `/catalog` 路径。当 master 在 `/catalog` 配置默认
`"prepend"` route 时，master 会把 `/catalog` 作为 slave base 传入。Slave 的本地
`/` 会渲染在 `/catalog`，本地 `/details` 会渲染在 `/catalog/details`。

Slave lifecycle 会加载原始生成 entry，通过 `pagesApp.updateRuntime()` 投影收到的
`base` 与 `history`，然后才调用 entry 的首次 `start()`。因此 router 在 Application
首次渲染前就能观察到挂载后的 base 与 history。在 qiankun 外独立运行时，同一组 Page
仍然使用 standalone base。

生成的 route types 始终描述 slave 本地源码树：其中是 `/` 与 `/details`，而不是
外部分配的 `/catalog` 前缀。

可选 runtime 模块只增加 lifecycle 行为，不会替换 framework entry：

```ts
// src/qiankun.slave.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props, ctx) {
    console.log(`${ctx.name} mounted`, {
      container: props.container,
      base: props.base,
      history: props.history,
    });
  },
  unmount() {
    console.log("slave unmounted");
  },
});
```

在 qiankun 模式下，插件挂载到 `props.container`；在 qiankun 外则自动启动同一个
canonical SPA entry。它不会推断 magic `src/main.tsx`，也不会暴露第二套
Application entry 模型。

## 模块引用

`resolver` 与 `runtime` 支持字符串模块 specifier、generated module ref，也支持
选择 named export 的对象：

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

字符串引用读取 default export：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
});
```

对象引用选择 named export：

```ts
evPluginQiankunSlave({
  runtime: {
    module: "/absolute/path/to/generated-slave-runtime.ts",
    exportName: "runtime",
  },
});
```

路径类引用会先基于项目根目录解析，再进入 bundling。包名 specifier 按项目依赖正常
解析。在另一个插件的 `contributions()` hook 中，可以把 `ctx.emit.module()`
返回的 opaque `GeneratedModuleRef` 直接传给 `contributeQiankunMaster()` 或
`contributeQiankunSlave()`。

## Runtime 形态

公开的 master 形态是：

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
  credentials?: boolean;
  props?: Record<string, unknown> & {
    settings?: QiankunLoadSettings;
  };
  [key: string]: unknown;
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
  appNameKeyAlias?: string;
  base?: string;
  history?: QiankunHistoryType;
  settings?: QiankunLoadSettings;
  lifeCycles?: QiankunLifeCycles;
  prefetch?: boolean | "all" | string[];
  prefetchThreshold?: number;
}
```

`base` 默认是 `/`，`history` 默认是 `"browser"`，缺省 `mode` 默认是
`"prepend"`。`settings` 由 route-mounted Applications 共享。
App 与 route settings 依次叠加在其上；route lifecycle hooks 会组合在 master
lifecycle hooks 之后。`credentials: true` 会在加载该 app entry 时携带 CORS
credentials。

`prefetch: "all"` 在 master 启动后预取全部 app，字符串数组按 name 预取选中的 app。
`prefetch: true` 会等首个 app 挂载后，再预取最多 `prefetchThreshold` 个其他 app；
threshold 默认是 `5`。

默认使用 `route.microApp` 匹配 `app.name`。`appNameKeyAlias` 可以为底层 adapter
选择另一个 app 身份字段，但把组织内部 DTO 映射为稳定 app identity 仍是平台插件的
职责。

Master 通过 slave lifecycle props 传递 route 派生值：

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

可选 slave runtime 支持：

```ts
interface QiankunSlaveRuntime {
  bootstrap?(props, ctx): void | Promise<void>;
  mount?(props, ctx): void | Promise<void>;
  unmount?(props, ctx): void | Promise<void>;
  update?(props, ctx): void | Promise<void>;
}
```

`ctx.loadEntry()` 会加载原始生成 entry，但不会启动它。在 `bootstrap()` 中调用是安全
的。首次 `mount()` 会先配置 runtime base/history，再调用 `start()`；后续重新挂载
复用已加载模块，并在当前 container 中调用其 render 路径。

## Qiankun 打包方式

默认情况下，qiankun 会进入应用 bundle：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
  externalQiankun: false,
});
```

仅在 runtime 环境提供该模块时设置 `externalQiankun: true`：

```ts
evPluginQiankunSlave({
  name: "catalog",
  externalQiankun: true,
});
```

## 本地开发

插件不会创建研发代理。如果 master 需要通过同源加载 slave dev server，请配置
`dev.proxy`：

```ts
// master ev.config.ts
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

Resolver app entry 指向代理后的 HTML。qiankun 3 使用 HTML entry URL，而不是
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

`evPluginQiankunSlave()` 会标记生成的 entry script，并把生成的根路径 JS/CSS URL
改写为相对 URL，因此同一份 slave HTML 可以在代理前缀下被消费。微前端资产代理应
放在 `dev.proxy`，而不是 `src/apis`；应用 request Route 不应代理微前端资产。

## 组合 Tern 平台插件

内网 Tern 插件位于公开 bridge 之上。职责边界是：

- `@evjs/plugin-qiankun` 持有 entry wrapping、lifecycle 集成、runtime route
  component、base/history 投影和 qiankun 加载行为。
- Tern 插件持有后台站点 DTO、app-id 适配、菜单、权限、部署 metadata、环境约定，
  以及 Tern-specific 研发服务。
- 业务应用只安装 Tern factory；不要再安装 standalone qiankun master/slave
  factory，也不要在 Page 中重复平台字段。

Tern 插件可以在自己的 `definePlugin()` descriptor 中复用公开 helper。组合后的
master 同时使用 contribution 与 hook helper：

```ts
import { definePlugin, pluginConfig } from "@evjs/ev/plugin";
import {
  contributeQiankunMaster,
  createQiankunMasterHooks,
} from "@evjs/plugin-qiankun";

type TernMasterConfig = {
  siteId: string;
  externalQiankun?: boolean;
};

export const ternMaster = definePlugin({
  id: "tern-master",
  application: pluginConfig<TernMasterConfig>(),

  setup() {
    return createQiankunMasterHooks();
  },

  async contributions(ctx) {
    const resolver = ctx.emit.module({
      id: "tern-master-resolver",
      scope: { kind: "application" },
      // Tern 私有代码根据自身后台 DTO 合同构造这段 source。
      source: buildTernResolverSource(ctx.options.siteId),
    });

    await contributeQiankunMaster(ctx, {
      resolver,
      ...(ctx.options.externalQiankun === undefined
        ? {}
        : { externalQiankun: ctx.options.externalQiankun }),
    });
  },
});
```

这里的 `buildTernResolverSource()` 是 Tern 私有实现，不是 evjs API。生成模块必须
default-export `defineQiankunMasterResolver()` 的结果，并把后台 DTO 适配为公开
snapshot。例如 adapter 可以把后台 application id 映射为稳定的 `app.name`，再在
`route.microApp` 中使用该名称：

```ts
const appNameByYuyanId = new Map(
  site.apps.map((app) => [app.yuyanId, app.name] as const),
);

function requireAppName(yuyanId: string | undefined): string {
  const name = appNameByYuyanId.get(yuyanId);
  if (!name) throw new Error(`Unknown Tern application "${yuyanId}".`);
  return name;
}

function adaptRoute(route: TernRoute) {
  if (route.redirect) {
    return { path: route.path, redirect: route.redirect };
  }
  return {
    path: route.path,
    microApp: requireAppName(route.microApp),
    ...(route.mode ? { mode: route.mode } : {}),
    microAppProps: normalizeTernMicroAppProps(route.microAppProps),
  };
}

return {
  apps: site.apps.map((app) => ({
    name: app.name,
    entry: app.entry,
    props: app.props,
  })),
  routes: site.routes.map(adaptRoute),
};
```

`normalizeTernMicroAppProps()` 同样是 adapter 私有代码；它会在返回公开 route shape
前移除或转换 Tern-only settings。Adapter 必须在返回 snapshot 前校验缺失的
identity。菜单层级、权限过滤、部署记录等字段仍属于 Tern data，不是开放 qiankun
route contract 的字段。

组合后的 slave 复用对应的 hook 与 contribution helper：

```ts
import { definePlugin, pluginConfig } from "@evjs/ev/plugin";
import {
  contributeQiankunSlave,
  createQiankunSlaveHooks,
} from "@evjs/plugin-qiankun";

type TernSlaveConfig = {
  name?: string;
  externalQiankun?: boolean;
};

export const ternSlave = definePlugin({
  id: "tern-slave",
  application: pluginConfig<TernSlaveConfig>({ defaults: {} }),

  setup(ctx) {
    return createQiankunSlaveHooks(
      ctx,
      ctx.options.name === undefined ? {} : { name: ctx.options.name },
    );
  },

  async contributions(ctx) {
    await contributeQiankunSlave(ctx, {
      ...(ctx.options.name === undefined ? {} : { name: ctx.options.name }),
      ...(ctx.options.externalQiankun === undefined
        ? {}
        : { externalQiankun: ctx.options.externalQiankun }),
    });
  },
});
```

如果 Tern 还持有同名 lifecycle hooks，其实现必须在自己的组合 hook 中调用返回的
qiankun hooks，而不是覆盖它们。

## 边界

`@evjs/plugin-qiankun` 包含：

- master 与 slave framework-entry wrapping；
- resolver/runtime 模块加载；
- Application 级 `apps/routes` 校验；
- runtime prepend、match、redirect 与微应用 route component；
- 生成的微应用 container 与 qiankun loading；
- 首次渲染前的 slave base/history 投影；
- slave lifecycle 导出与 standalone 渲染；
- `externalQiankun` 支持；
- 供平台组合的 contribution 与 hook helper。

它不包含：

- 后台站点 DTO 协议；
- 菜单或权限；
- 组织内部部署或发布 metadata；
- 自动本地研发代理；
- Page 级 qiankun settings；
- 从 resolver data 派生的 canonical CoreGraph Page、Route 或 Document；
- runtime resolver route 对应的生成 `RoutePath`。
