# 本次播放后端改动最终核对

核对日期：2026-10-22。以当前工作区相对 HEAD 的完整 diff、新增源码、测试和文档为范围。
本机为 Windows x64；验证使用独立构建的原生插件，不读取或修改用户曲库、播放队列和设置。

## 文件核对清单

| 文件 | 核对重点 |
| --- | --- |
| `engine-core/include/easy_player/audio_backend.h` | 事件位、checked flush 的兼容默认实现 |
| `engine-core/include/easy_player/audio_engine.h` | 控制接口、生命周期辅助函数及现有版本号 |
| `engine-core/include/easy_player/dsp_pipeline.h` | SRC 后排空变速尾部、预分配补零、时长限制、reset/configure 清理 |
| `engine-core/src/audio_engine.cpp` | 播放、暂停、seek、设备重建、EOF、恢复失败、进度恢复及打开失败重试 |
| `engine-windows/src/addon.cpp` | Windows 控制线程事件入口与互斥保护 |
| `engine-windows/src/asio_backend.h`、`asio_backend.cpp` | 驱动创建、COM 生命周期、缓冲协商、预填充、错误传递、DoP 标记 |
| `engine-windows/src/asio_control_thread.h` | STA 消息泵、任务唤醒、退出及线程内重入 |
| `engine-windows/src/wasapi_backend.h`、`wasapi_backend.cpp` | 实际启动结果握手、渲染失败、停止和 seek 刷新错误 |
| `engine-windows/src/dsound_backend.h`、`dsound_backend.cpp` | 实际启动结果握手、渲染失败、seek 各步骤错误及线程退出 |
| `src/main/audioEngine/index.ts` | 后台设备事件轮询、退出时清理轮询 |
| `src/main/ipc/audioIpcHandlers.ts`、`src/main/index.ts` | 退出前保存最新进度、保存先于 stop/关闭数据库、重复清理不写入零进度 |
| `scripts/test-playback-checkpoint.mjs` | 退出顺序、重启、延后恢复、暂停和 Ready seek；通过 ESLint |
| `scripts/test-preference-defaults.mjs` | 补齐已有主题预览模块 mock；业务逻辑未调整 |
| `tests/native/CMakeLists.txt` | 原生回归测试依赖和目标；实机诊断不自动加入 CTest |
| `tests/native/asio_activation_probe.cpp`、`asio_backend_probe.cpp` | 真实驱动诊断仅验证显式指定的 ASIO4ALL，静音输出 |
| `tests/native/asio_backend_test.cpp` | 模拟驱动生命周期、STA、消息循环、失败、DoP 和缓冲边界 |
| `tests/native/windows_backend_failure_test.cpp` | WASAPI/DirectSound 实际控制路径的故障注入 |
| `tests/native/audio_backend_recovery_test.cpp` | 引擎恢复、进度、错误、完整播放生命周期和无缝切歌 |
| `tests/native/dsp_stream_end_test.cpp` | 短/长音频、不同倍速、SRC、重复 EOF 与处理管线复用 |
| `docs/engine/asio-stability.md`、`playback-backend-recovery.md` | 修复行为、回归命令及未覆盖范围与实现一致 |

## 最终核对中补充的修正

设备格式协商失败后，原来仍保留半打开的 backend_；再次点击播放会跳过协商。
现已关闭并清空失败对象，使下一次播放重新初始化设备。新增测试在修复前失败、修复后通过。
同时补齐原有设置默认值测试缺失的主题预览模块 mock，以及新测试脚本的 lint 配置。

## 已通过的验证

- 完整原生构建。
- `npm run build`：主进程和前端类型检查，以及 Electron/Vite 完整构建。
- 修改的 TypeScript/JavaScript 文件的 ESLint、Prettier 检查；`git diff --check`。
- CTest 9 项全部通过，包含扩展后的正常播放生命周期：播放前 seek、暂停持位、暂停 seek、
  续播、播放中切换输出、重采样重建、无缝切歌、重新打开和停止。
- 播放模式、随机播放、快捷键、渲染器持久化、播放进度保存、闲置任务、设置默认值测试全部通过。
- 最新原生插件通过真实 WASAPI Shared、DirectSound、ASIO4ALL 静音流程测试：
  恢复位置后播放、暂停/续播、seek、输出重建和重新打开曲目。
  实机诊断等待实际进度推进，允许驱动首次启动和重启所需的时间。
- 分析开启、普通模式、极简模式共 6 轮持续播放检查通过，均无检测到的播放中断；
  同时验证模式切换、暂停、seek 和续播。结果保存在 `build/playback-performance.json`。

## 验证边界与已知原有问题

静音实机检查验证设备控制与持续回调，不等同于听感、bit-perfect 或 DAC 端的 DoP 认证。
DoP 的有效载荷/标记及暂停重启由软件测试覆盖；未使用真实 DSD DAC 验证。
WASAPI Exclusive 的故障路径有模拟测试，未在此次实机流程中占用独占设备。
macOS/Android 未在本机编译运行，公共后端新增方法保留兼容默认实现。
运行中的播放器仍占用常规输出目录中的旧原生插件；本次使用独立目录构建和验证最新版。
正式使用前需退出播放器，执行 `npm run build:native` 后重新启动。

此前审查中尚未安排修复的四项仍然存在：EOF 后硬件缓冲排空、DirectSound 忽略指定设备、
环形缓冲长期计数溢出、EOF 实时回调加锁/字符串操作。本次核对不把这些原有问题描述为已解决。
