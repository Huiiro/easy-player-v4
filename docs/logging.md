# 日志实现

## 统一链路

运行时日志由 Electron 主进程的 `Logger`（`src/main/service/loggerService.ts`）统一接收。每条记录包含 `id`、毫秒时间戳、级别（`debug/info/warn/error`）、来源（`main/native/renderer/preload`）和消息。主进程同时将记录输出到终端、写入日志文件，并通过 `log:entry` 广播给所有窗口。

| 来源            | 接入方式                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron 主进程 | 使用 `Logger.debug/info/warn/error(message, ...details)`；特殊来源可用 `Logger.write(level, source, message)`。                                    |
| C++ 音频引擎    | 使用 `LOG_DEBUG/INFO/WARN/ERROR`；N-API `onLog` 回调在创建引擎后立即注册，再由主进程标记为 `native`。                                              |
| Renderer        | 启动时安装控制台转发，现有 `console` 调用仍在 DevTools 可见，并经 `log:write` 进入主进程。界面主动添加的日志通过 `useLogStore().addEntry()` 提交。 |
| Preload         | 桥接初始化失败时经 `log:preload` 上报。                                                                                                            |

日志面板在 renderer 启动时订阅统一的 `log:entry`，并通过 `log:recent` 读取本次进程最近 1000 条记录。按 `id` 去重，避免补读和实时事件重叠。面板的 Clear 只清空当前窗口显示，不删除日志文件。

## 文件位置与格式

日志目录由 `getLogPath()` 指定：Windows 为 `%APPDATA%/easy-player/player_log`，其他平台目前为 `~/Library/Application Support/easy-player/player_log`。文件按 UTC 日期命名为 `log-YYYY-MM-DD.log`；每行格式为：

```text
[2026-09-25T10:00:00.000Z] [WARN] [native] CoreAudio: example message
```

写文件失败时会在主进程控制台报告失败，原始日志仍尝试输出并广播。`createDir()` 在主进程启动阶段创建目录；该阶段的目录创建失败只能输出到控制台。构建脚本的控制台输出属于构建日志，不进入应用运行时日志。

## 记录约定

- 新增主进程代码直接使用 `Logger`，不要只调用 `console`。
- native 代码继续使用 `LOG_*`，避免在音频实时回调中做阻塞的日志工作。
- renderer 的普通控制台调用已转发；需要在面板显示业务事件时使用 `useLogStore().addEntry()`。
- 不记录令牌、密码、完整远程请求头等敏感数据。高频音频回调中避免逐帧记录。
