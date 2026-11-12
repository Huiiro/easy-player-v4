# 性能与资源释放复查（2026-11-12）

本轮覆盖主进程日志、网络封面下载、播放分析轮询、目录自动导入、搜索索引 Worker、背景图像/GPU 资源与退出释放。采用代码审查、真实 Store/网络流生命周期回归、隔离原生播放和完整 Electron 应用采样。没有读取或修改用户音乐库。

## 已修复

| 问题                       | 影响与触发条件                                                                                                       | 修复及验证                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 被过滤日志仍序列化参数     | `Logger.write()` 在等级过滤前调用 `JSON.stringify`；大量 debug 上下文即使不输出仍消耗 CPU 并创建临时字符串           | 提前检查等级及极致模式；测试用 `toJSON` 计数证明被过滤参数不再序列化                                              |
| 下载封面超限仍持续接收     | `fetchMediaImage()` 超过 5 MiB 后停止缓存，但等响应结束才拒绝；慢速/持续响应继续消耗网络、事件回调，已存数据仍被持有 | 越过上限立即清空缓存、拒绝请求并 abort；测试覆盖恰好上限、超出一字节且不发送 end、模式/退出监听释放和正常响应     |
| HTTP 错误封面未取消响应体  | `fetchArtworkDataUrl()` 对非成功 HTTP 状态直接抛错，未主动释放未读取的流                                             | 抛错前取消响应体；403 回归验证 body 被消费/取消                                                                   |
| 取消订阅后分析轮询可能复活 | `unsubscribe()` 只能清除已创建的 timeout；在途分析请求的 finally 仍可创建新 timeout                                  | 显式约束订阅状态，同时检查轮询入口及异步完成回调；真实 Pinia Store 测试验证迟到结果不重启，重新订阅只启动一个循环 |

同时修复现有 `check-player-app.cjs` 的独立 SQLite 写连接未注册 `search_normalize`，该缺失会让当前 schema 的写入触发器报错，阻止整应用采样。补充可选的停止播放后可见、隐藏、恢复采样；更新播放事件与播放模式回归中过时的依赖模拟。

## 原生播放实测

Windows x64，Node 24.21.0，当前 `build/native-addon/easy_player_native.node`；48 kHz 双声道 PCM16 合成音频、WASAPI shared、音量 0。各场景独立进程，两轮，每轮预热 1.5 秒、测量约 6 秒。未重建原生模块，本轮没有修改原生代码。

| 场景                   | CPU 单核占用范围 |   平均 RSS 范围 |
| ---------------------- | ---------------: | --------------: |
| 普通播放，无分析       |      0.24%–1.02% | 69.20–69.24 MiB |
| 极致播放               |      0.00%–0.26% | 69.20–69.23 MiB |
| 频谱和响度分析同时开启 |    11.78%–15.68% | 68.95–69.20 MiB |

六个场景播放进度正常，欠载均为 0。各次测量首尾 RSS 差在 -0.34 至 +0.09 MiB。`0.00%` 是短采样/CPU 计时分辨率下的结果，不能解释为完全没有 CPU 工作；这些数据不能排除数小时运行的慢泄漏。分析开启后的原生 CPU 开销仍值得后续独立 profile，本轮未改变分析精度或刷新体验。

## 完整 Electron 应用实测

使用修复后重新构建的应用，Electron 39.8.10，独立空库加入两个合成音频。普通窗口和恢复窗口分别采样约 3 秒；极致窗口采样 60 秒；停止播放后每种闲置状态先稳定 3 秒，再采样 20 秒。内存为主进程、渲染器、GPU 等 Electron 进程的读数之和。

| 场景               | CPU 平均（Electron 读数求和） | 平均工作集 | 平均私有提交 |
| ------------------ | ----------------------------: | ---------: | -----------: |
| 普通窗口播放       |                        0.175% |  734.2 MiB |    584.8 MiB |
| 极致窗口播放       |                        0.068% |  323.0 MiB |    410.4 MiB |
| 恢复普通窗口播放   |                        0.409% |  454.1 MiB |    594.5 MiB |
| 停止播放，可见     |                        0.032% |  444.5 MiB |    530.6 MiB |
| 停止播放，隐藏     |                        0.018% |  437.1 MiB |    511.7 MiB |
| 停止播放，再次显示 |                        0.016% |  440.2 MiB |    531.8 MiB |

Electron CPU 口径与上文原生进程单核口径不同，不直接比较。普通窗口仅 3 秒，尤其受启动和内存回收影响，不能视为长期稳定占用。此次极致工作集也高于历史约 200 MiB 测量，不将旧目标作为当前环境保证。

验证了真实渲染进程替换、队列保持和持续播放进度；极致模式新增欠载为 0，renderer 错误列表为空。隐藏阶段的 `document.hidden` 为 true，显示阶段为 false。三个闲置阶段的工作集首尾分别为 443.7→438.5、438.7→436.9、446.7→439.3 MiB，没有连续增长迹象。浏览器 `performance.memory` 报告的 JS 已用堆均约 14.5 MiB；该接口可能有粒度限制，且不含原生/GPU 内存，不能单凭它证明没有泄漏。

测试使用应用现有的一次性工作集回收策略，没有增加强制 GC 或周期性 trim。闲置采样中每秒读取一次浏览器指标，测量自身有少量开销。未覆盖真实大库、远程慢盘、第三方动态主题、数小时切歌及全部音频后端。

## 后续热点

以下有代码依据，但本轮没有测量其在真实大库上的耗时或内存大小，不将其当作已证实的泄漏：

1. `musicFolderWatcher.ts` 对每个 dirty 根目录调用 `knownFiles()`，其实现每次同步读取全曲库本地路径、创建 Set；默认每 60 秒递归协调一次。多个根目录、大库及大量文件通知时，会重复分配与扫描。应对真实目录进行 I/O 和事件循环采样，再评估文件级增量处理、分批让出与已知路径缓存失效策略。
2. `loggerService.ts` 对实际输出的每条日志仍同步 mkdir/append，并向所有窗口广播。debug 被显式打开或日志密集时仍可能阻塞主线程；本轮只消除被过滤消息的无效序列化。若改为批量异步写盘，需同时设计队列上限、错误处理和退出 flush。
3. `remoteSourceService.ts` 每次新下载完成后同步枚举缓存、逐文件 stat、排序及删除。缓存文件多或磁盘慢时可能阻塞主线程。缓存命中不走此清理路径。
4. 搜索 Worker 建立日语索引后保留 kuromoji 字典及最多 4096 条读音缓存，直到服务停止/失败；属于有生命周期的常驻资源。可以单独测量字典体积和空闲回收后的重载延迟。
5. Windows 设备恢复仍有 100 ms 轮询，以处理后台驱动通知；不能仅因其持续存在就直接删除。空闲优化需要验证设备断开/重连与后台恢复。

背景图像缓存已有数量上限；声明式主题位图卸载时 close、纹理/缓冲/程序删除及 WebGL context 释放路径存在，CoverAura Worker 卸载时 terminate。上一轮可见性/KeepAlive 停表、频谱收敛停止和进程退出等待测试仍通过。代码存在清理路径不等同于已证明所有 GPU 驱动和主题都没有资源问题。

## 验证与复现

完整 TypeScript 检查、应用构建、本轮文件 ESLint、以下回归通过：

```powershell
node scripts/test-idle-work.mjs
node scripts/test-resource-lifecycle.mjs
node scripts/test-application-shutdown.mjs
node scripts/test-plugin-logs.mjs
node scripts/test-source-runtime.mjs
node scripts/test-media-image-lifecycle.mjs
node scripts/test-playback-events.mjs
node scripts/test-playback-mode.mjs
node scripts/check-playback-performance.cjs
```

完整应用采样使用独立数据目录和两个合成音频，测试音量为 0。报告位于构建目录，不纳入 Git：

```powershell
npm run build:nocheck
$env:PERF_EXTREME_SECONDS='60'
$env:PERF_IDLE_SECONDS='20'
try { npm run perf:app } finally {
  Remove-Item Env:PERF_EXTREME_SECONDS
  Remove-Item Env:PERF_IDLE_SECONDS
}
```

原始报告：`build/playback-performance.json`、`build/playback-app-performance.json`；修复前短基线另存为 `build/playback-app-performance-baseline-2026-11-12.json`。修复前后极致模式采样长度不同，且本轮修复的触发条件不是这些合成播放场景，因此不能用两份结果宣称整体性能降幅。
