# 插件日志

插件日志沿用应用 Logger 的级别、文件与实时事件，不另建一套文件日志系统。插件设置提供“插件日志”入口，也可从单个已安装插件的日志按钮直接查看。

## 查看与保存

- 可以按插件 ID、级别和关键词筛选，复制当前筛选结果，或打开日志目录。
- 当前会话保留最近 1000 条插件记录，独立于全局最近日志缓冲；普通应用日志不会挤掉这些记录。卸载后仍可通过“全部插件”查看该会话的记录。
- 文件继续写入应用数据位置下的 `player_log/log-YYYY-MM-DD.log`，日期为 UTC，与应用日志共同保存。界面不读取上次启动的文件历史，历史内容可从目录查看。
- 记录级别使用“设置 → 系统 → 日志记录级别”，默认 Info。Debug 会增加成功调用与取消信息；界面的级别筛选只筛选已记录的条目，不改变记录级别。
- 轻量播放模式继续只记录 Error。关闭查看窗口会注销事件订阅，不停止宿主日志记录。

## 记录内容

| 类型             | 默认级别            | 内容                                                          |
| ---------------- | ------------------- | ------------------------------------------------------------- |
| 安装、更新、卸载 | Info / Error        | 开始、提交成功、失败与旧版本保留情况                          |
| 生命周期         | Info / Warn / Error | 启动、停用、实际失败原因及资源清理错误                        |
| 来源调用         | Debug / Warn        | 来源、操作、调用 ID、耗时和错误代码；普通取消使用 Debug       |
| 主题渲染         | Error               | shader 编译、链接、纹理/资源加载、字体解码、iframe 加载或超时 |
| 插件主动日志     | 插件指定            | 由宿主绑定插件 ID 与激活版本后记录                            |

结构化上下文为 `pluginId`、可选 `version/sourceId/operation/code/elapsedMs/callId`。来源调用在入口保存插件身份和版本；旧调用在插件更新后结束时不会被标成新版本。主题报告必须匹配当前活动包的哈希，过期或已停用主题的报告不会计入当前版本。

SDK 主动消息使用 `operation: plugin`，生命周期使用 `lifecycle`，包管理使用 `install/update/uninstall/load`，来源调用使用 `metadata.search` 等实际操作，渲染失败使用 `theme.render`。无法归属插件的应用操作继续记录到普通应用日志。

## 插件开发

现有 SDK 接口保持不变，网络来源可以使用激活上下文或调用上下文中的服务：

```ts
host.log('info', 'Metadata source initialized')
context.host?.log('debug', 'Metadata response parsed')
context.host?.log('warn', 'Metadata response missing required fields')
```

插件不需要指定自己的 ID、版本或日志目录。上游库直接使用 console 输出的内容不会自动获得插件身份，插件自己输出的诊断应使用宿主接口。主题使用宿主包装器上报失败，沙箱 iframe 不获得日志 IPC 或应用权限。

不要记录 Cookie、Authorization、令牌、完整响应体、配置或完整签名 URL。宿主对已识别的凭据字段、认证头、Bearer 值和 URL 查询/片段/用户信息进行脱敏，并限制消息长度；这些规则不能识别任意格式或藏在 URL 路径中的秘密，作者仍需避免输出敏感值。调用运行时默认只记录操作概要与错误代码。

## 实现与验证

- `src/shared/pluginLogs.ts`：上下文 DTO、长度限制与脱敏。
- `src/main/service/loggerService.ts`：统一落盘、独立插件缓冲、窗口通知与目录入口。
- `plugins/manager.ts`、`packages.ts`、`sources/runtime.ts`：生命周期、事务与调用身份。
- `ipc/pluginIpcHandlers.ts`、`sourceCallIpcHandlers.ts`：日志读取、主题版本检查与调用概要。
- `PluginLogDialog.vue`：筛选、实时订阅、历史去重、复制与关闭清理。

`npm run test:plugin-logs` 覆盖文件输出、脱敏、记录级别、条数上限、窗口/文件失败隔离、生命周期细节、版本归属、来源调用身份与主题报告准入。`npm run test:appearance` 覆盖真实日志窗口的插件筛选、搜索、级别过滤、实时去重和订阅释放。插件安装与来源运行时回归继续检查日志不会改变操作结果。
