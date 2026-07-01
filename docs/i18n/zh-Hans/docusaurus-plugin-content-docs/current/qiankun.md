# Qiankun 插件

`@evjs/plugin-qiankun` 让 evjs 单页应用参与
[qiankun](https://github.com/umijs/qiankun) 主/子应用微前端拓扑。它只做协议桥接：
包装当前配置的 app entry、接入 qiankun lifecycle，并加载用户提供的 resolver/runtime
模块。它不拥有应用路由、平台站点元数据、部署字段或本地研发代理约定。

当 SPA 应用明确以 qiankun master 或 slave 身份运行时再启用这个插件。默认路径是
evjs file-convention SPA，也就是 `src/pages`。不要把它用于 MPA 页面。

## 安装

```bash
npm install @evjs/plugin-qiankun qiankun
```

## Master 应用

Master 应用注册子应用并启动 qiankun。使用 `evPluginQiankunMaster()` 配置插件，
并提供 resolver 模块：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

resolver 返回 qiankun 应用列表、可选路由映射，以及 qiankun framework options。
这些字段保持扁平：

```ts
// src/qiankun.master.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => ({
  apps: [
    {
      name: "catalog",
      entry: "//localhost:3001",
      container: "#slave-container",
    },
  ],
  routes: [
    {
      path: "/catalog",
      microApp: "catalog",
    },
  ],
  sandbox: true,
  prefetch: true,
}));
```

`routes` 是 evjs 插件提供的便利映射，不是路由系统替代品。当 app 没有显式
`activeRule` 时，插件会根据匹配的 `routes[].microApp` 推导 `activeRule`，并通过
qiankun 的 `registerMicroApps` 注册应用。Master 运行期间应由 shell 稳定提供
qiankun container；如果希望 container 跟随路由组件挂载，应由上层插件把 route
转换成 micro-app 组件。

```tsx
// src/layout/index.tsx
import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/catalog">Catalog</Link>
      </nav>
      {children}
      <section id="slave-container" />
    </main>
  );
}
```

```tsx
// src/pages/catalog.tsx
export default function CatalogPage() {
  return <h1>Catalog workspace</h1>;
}
```

## Slave 应用

Slave 应用向 master 暴露 qiankun lifecycle，同时在非 qiankun 环境下仍能独立渲染。
使用 `evPluginQiankunSlave()`：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export default defineConfig({
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
```

应用仍然是普通 file-convention SPA：

```tsx
// src/pages/index.tsx
export default function CatalogPage() {
  return <h1>Catalog</h1>;
}
```

当 master 在非根路径激活 slave 时，slave 也需要提供对应 page route，例如
`src/pages/catalog.tsx`。

runtime 模块只用于扩展 lifecycle。如果应用不需要额外行为，可以不提供 runtime：

```ts
// src/qiankun.slave.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props, ctx) {
    console.log(`${ctx.name} mounted`, props.container);
  },
  unmount() {
    console.log("slave unmounted");
  },
});
```

在 qiankun 环境中，插件会挂载到 `props.container`；在非 qiankun 环境中会自动
standalone 渲染。对于手写 `app.entry` 的 SPA，runtime 会把
`document.querySelector(mount)` 和 `document.getElementById()` 的挂载查询临时限定到
qiankun container 内，因此常见的单页应用入口可以继续使用 `#app`。

## 模块引用

`resolver` 和 `runtime` 支持字符串模块引用，也支持带 named export 的对象引用：

```ts
type QiankunModuleRef =
  | string
  | {
      module: string;
      exportName?: string;
    };
```

字符串引用读取 default export：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
});
```

对象引用适合生成模块或 named export：

```ts
evPluginQiankunSlave({
  runtime: {
    module: "/absolute/path/to/generated-slave-runtime.ts",
    exportName: "runtime",
  },
});
```

路径类引用会先基于项目根目录解析，再进入 bundling，因此生成的 entry wrapper
不会保留未解析的 `./src/...` specifier。包名 specifier 则按项目依赖正常解析。

## Runtime 形态

Master resolver 返回：

```ts
interface QiankunMasterOptions {
  apps?: QiankunApp[];
  routes?: Array<{ path: string; microApp: string }>;
  appNameKeyAlias?: string;
  sandbox?: boolean | Record<string, unknown>;
  prefetch?: boolean | string[] | ((apps: QiankunApp[]) => unknown);
  singular?: boolean | ((app: QiankunApp) => Promise<boolean>);
  fetch?: typeof globalThis.fetch;
  [key: string]: unknown;
}
```

`apps`、`routes` 和 qiankun options 在同一层级，没有 `framework` 包裹。除
`apps`、`routes`、`appNameKeyAlias` 外，其他字段会传给 `qiankun.start()`。

Slave runtime 可扩展以下 lifecycle：

```ts
interface QiankunSlaveRuntime {
  bootstrap?(props, ctx): void | Promise<void>;
  mount?(props, ctx): void | Promise<void>;
  unmount?(props, ctx): void | Promise<void>;
  update?(props, ctx): void | Promise<void>;
}
```

`ctx.loadEntry()` 会加载原始 app entry。内置 slave lifecycle 会在可选 runtime
`mount()` hook 执行后，于 `mount()` 阶段调用它。

## Qiankun 打包方式

默认情况下，qiankun 会进入应用 bundle：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
  externalQiankun: false,
});
```

如果部署环境提供了外置 qiankun，可以设置 `externalQiankun: true`：

```ts
evPluginQiankunSlave({
  name: "catalog",
  externalQiankun: true,
});
```

## 本地开发

插件不内置本地研发代理。如果 master 需要通过同源路径加载 slave dev server，
请在 master 应用的 `dev.proxy` 中配置：

```ts
// master 应用的 ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
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

resolver 指向代理后的 HTML entry。qiankun 3 消费的是 HTML entry URL，不再是
`{ scripts, styles, html }` 对象。`evPluginQiankunSlave()` 会为 qiankun 3 标记产物
HTML 中的 entry script，并把生成的根路径 JS/CSS 资源 URL 改成相对 URL，因此同一份
slave HTML 可以挂在 `/__qiankun_slave` 这样的路径前缀下被 master 消费：

```ts
const slaveBase = "/__qiankun_slave";

export default async function resolveQiankunMaster() {
  return {
    apps: [
      {
        name: "catalog",
        entry: new URL(`${slaveBase}/index.html`, window.location.href).href,
        container: "#slave-container",
      },
    ],
    routes: [{ path: "/catalog", microApp: "catalog" }],
    sandbox: true,
    prefetch: true,
  };
}
```

请把这类代理放在 `dev.proxy`，不要放进 `src/apis`；应用 API routes 不应该承担
微前端资产代理职责。

## 在平台插件上扩展

大型组织通常会在 qiankun 之上有一层微前端平台：站点配置服务、部署侧应用身份、
默认 sandbox 规则、路由映射约定，或平台专属 mount props。请把这些平台逻辑留在
`@evjs/plugin-qiankun` 外部。

推荐分层是组合：

- `@evjs/plugin-qiankun` 负责 qiankun 协议桥接。
- 平台插件负责平台元数据、生成 resolver/runtime 模块、默认 dev proxy 规则和部署约定。
- 业务应用消费平台插件，通常不需要手写 `src/qiankun.master.ts` 或
  `src/qiankun.slave.ts`。

平台 master 插件可以生成 resolver 模块，再传给开源插件：

```ts
// packages/plugin-platform/src/master.ts
import { merge } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendMaster(): Plugin[] {
  const generatedResolver = createGeneratedMasterResolverModule();

  return [
    {
      name: "@acme/evjs-platform-mf:master-config",
      config(config) {
        merge(config, {
          dev: {
            proxy: [
              {
                context: ["/__platform_slave"],
                target: "http://localhost:3001",
                pathRewrite: { "^/__platform_slave": "" },
                changeOrigin: true,
                secure: false,
              },
            ],
          },
        });
        return config;
      },
    },
    evPluginQiankunMaster({
      resolver: {
        module: generatedResolver,
      },
      externalQiankun: true,
    }),
  ];
}

function createGeneratedMasterResolverModule(): string {
  // 返回平台插件生成模块的绝对路径。
  return "/absolute/path/to/generated-master-resolver.ts";
}
```

生成的 resolver 把平台元数据适配为开源 qiankun resolver 形态：

```ts
// generated-master-resolver.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => {
  const site = await loadPlatformSiteConfig();

  return {
    apps: site.children.map((child) => ({
      name: child.name,
      entry: child.entry,
      container: child.container,
      props: child.props,
    })),
    routes: site.routes.map((route) => ({
      path: route.path,
      microApp: route.childName,
    })),
    sandbox: site.sandbox ?? true,
    prefetch: site.prefetch ?? true,
  };
});
```

平台 slave 插件可以生成 runtime 模块，并把推导出的应用名传给开源插件：

```ts
// packages/plugin-platform/src/slave.ts
import type { Plugin } from "@evjs/ev/plugin";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendSlave(): Plugin[] {
  const generatedRuntime = createGeneratedSlaveRuntimeModule();
  const appName = inferPlatformAppName();

  return [
    evPluginQiankunSlave({
      name: appName,
      runtime: {
        module: generatedRuntime,
      },
      externalQiankun: true,
    }),
  ];
}

function createGeneratedSlaveRuntimeModule(): string {
  return "/absolute/path/to/generated-slave-runtime.ts";
}

function inferPlatformAppName(): string {
  return "catalog";
}
```

生成的 slave runtime 可在业务代码观察 props 之前统一平台专属 mount props：

```ts
// generated-slave-runtime.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props) {
    const platformProps = normalizePlatformProps(props);
    Reflect.set(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__", platformProps);
  },
  unmount() {
    Reflect.deleteProperty(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__");
  },
});
```

这样可以保持开源插件稳定、可复用，同时让平台插件在边界处把内部站点配置、应用身份、
别名、路由约定和部署默认值映射到 qiankun 协议。

## 边界

`@evjs/plugin-qiankun` 包含：

- master 和 slave app-entry 包装；
- resolver/runtime 模块加载；
- qiankun lifecycle 导出；
- slave standalone 渲染；
- `externalQiankun` bundler external 支持；
- resolver/runtime 模块的 TypeScript helper。

它不包含：

- 平台专属站点配置协议；
- 组织内部应用身份字段；
- 部署元数据或发布平台字段；
- 本地开发 HTML 改写服务；
- 自动 master proxy 生成；
- 除 route 到 `activeRule` 映射以外的额外路由语义。
