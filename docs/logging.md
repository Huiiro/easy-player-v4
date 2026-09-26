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

## 记录级别

设置 → 系统设置中的“日志记录级别”控制记录的最低级别，默认 `info`。级别按 `debug < info < warn < error` 排序：例如选择 `info` 时记录 `info/warn/error`，选择 `error` 时只记录错误。设置保存在应用数据库的 `logging.level` 中，修改立即生效，并在下次启动、音频引擎初始化前恢复。

低于所选级别的新日志不会进入文件、主进程终端、最近记录缓存或日志面板；已有记录保留。Renderer 的原始 DevTools 控制台输出仍然保留。日志面板的级别筛选只影响显示。

## 文件位置与格式

日志目录由 `getLogPath()` 指定：Windows 为 `%APPDATA%/easy-player/player_log`，其他平台目前为 `~/Library/Application Support/easy-player/player_log`。文件按 UTC 日期命名为 `log-YYYY-MM-DD.log`；每行格式为：

```text
[2026-09-25T10:00:00.000Z] [WARN] [native] CoreAudio: example message
```

写文件失败时会在主进程控制台报告失败，原始日志仍尝试输出并广播。`createDir()` 在主进程启动阶段创建目录；该阶段的目录创建失败只能输出到控制台。构建脚本的控制台输出属于构建日志，不进入应用运行时日志。

## 记录约定

- native 的 `debug/warn/error` 自动附带 `[文件名:行号 函数名]`；Windows HRESULT 保留实际十六进制值，FFmpeg 错误同时记录错误码和解释。
- native 常规命令、DSP 参数变更、设备枚举、格式协商、播放/停止/切歌及解码统计使用 `debug`；命令记录关键参数、前后状态和耗时。对象参数解析异常会标出正在读取的字段，EQ/DSP 数组会标出索引。
- native 的 `info` 保留引擎初始化等低频关键事件。可预期的格式尝试失败使用 `debug`，最终失败及异常仍使用 `warn/error`。连续坏帧首次使用 `warn`，后续重试使用 `debug`，达到失败条件仍使用 `error`。
- FFmpeg 内部输出通过线程安全回调进入 native 日志，不再直接写 stderr。原始 `error/warning/info` 作为 `debug` 诊断保存，并在消息中保留 FFmpeg 原始级别、组件、文件、操作阶段和操作开始时的采样位置；`fatal/panic` 保留 `error`。codec 自身的 `error` 不等于播放器操作失败，播放器仍依据返回码记录坏帧跳过的 `warn` 和无法恢复的 `error`，恢复后补充 `debug`。同线程的后台淡出分析会标出 `parent_operation=auto-crossfade-analysis`；FFmpeg 内部工作线程没有继承操作上下文时只保留组件信息。
- 新增主进程代码直接使用 `Logger`，不要只调用 `console`。
- native 代码继续使用 `LOG_*`，避免在音频实时回调中做阻塞的日志工作。
- renderer 的普通控制台调用已转发；需要在面板显示业务事件时使用 `useLogStore().addEntry()`。
- 不记录令牌、密码、完整远程请求头等敏感数据。高频音频回调中避免逐帧记录。
