# 服务端定时任务

任务统一声明在固定的 `src/schedules/` 目录中，支持 `.ts`、`.tsx`、`.js` 和 `.jsx`，目录内的文件名和子目录可自由组织：

```ts title="src/schedules/orders.ts"
import { defineSchedule } from "@evjs/ev/schedule";
import { reconcileOrders } from "../services/orders";

export const syncOrders = defineSchedule(
  { cron: "0 0/5 * * * ?" },
  async () => { await reconcileOrders(); },
);
```

无需特殊文件名、配置入口或页面引用。core 只在 `src/schedules/` 内静态发现命名 `export const` 声明。目录外的声明不会注册为任务，即使被任务模块 import；handler 可以引用其他目录中的业务函数。`defineSchedule` 返回原 handler，不启动计时器。部署适配器负责校验 cron 方言并接入平台调度，core 本身不提供调度器。

选项必须是对象字面量，包含非空字符串 `cron`，以及可选字符串 `id`、布尔值 `disable`。任务 ID 默认采用导出名；重命名导出前可用 `id` 固定身份，在 `src/schedules/` 内移动文件不改变身份。重复 ID、动态选项、展开属性、工厂和默认导出会产生构建错误；支持 import 别名。handler 无参数，异步工作必须纳入返回的 Promise。返回值忽略，异常向上传播。

发现范围排除类型声明文件、`.test.*`/`.spec.*`、隐藏目录、依赖、构建产物，以及 `test`、`tests`、`__tests__`、`__mocks__`、`generated`、`__generated__`。重新导出不创建新任务。任务模块不能声明 `"use server"`，也不能进入客户端引用链；共享 DTO 和工具放在单独模块中，允许仅类型引用。

```sh
ev inspect
ev schedule run syncOrders
```

`inspect` 显示构建声明，不表示平台实时开关。`schedule run` 将服务端代码编译到临时目录，执行指定任务一次（包括 disable 的任务），等待完成后清理；不生成部署产物，也不替换 `dist`。未知 ID 和 handler 异常使命令以非零状态退出。`ev dev` 不运行周期任务。

构建图通过 `serverSchedules` 暴露任务，构建输出与部署元数据通过 `server.schedules` 暴露任务。纯任务应用生成包含 `runSchedule(taskId)` 的服务端入口，不生成任务 HTTP 端点。cron 校验、平台身份、开关、重试、并发和时区由部署适配器及平台负责；业务需要按重复执行的可能性设计幂等。
