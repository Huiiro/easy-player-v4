# Android 开发计划

## 目标与边界

Android 版本复用 `engine-core` 的解码、播放状态与 DSP 能力；采用
`engine-android` 提供 AAudio/JNI 适配。下载、Windows 音频设备枚举、ASIO、
WASAPI 与 Electron UI 保持为桌面端能力，不进入 Android 产品范围。

最低系统版本为 Android 9（API 28）。AAudio 本身从 API 26 可用，但当前静态 FFmpeg
`avformat` 构建使用的 `glob` 符号从 API 28 才由 Android 系统提供。

## 里程碑

### M0：可重复的应用基线（已完成）

- Kotlin/Gradle 应用可从 `android-app` 独立打开。
- `:app:assembleDebug` 生成并可安装 Debug APK。
- 验收：模拟器或实体设备能启动 `MainActivity`。

### M1：原生引擎构建链路（已完成）

- 在 SDK Manager 安装 **NDK (Side by side)** 与 **CMake 3.22.1**（已完成；构建固定使用
  NDK `27.0.12077973`）。
- 为每个首发 ABI 导入 FFmpeg、libsamplerate 与 SoundTouch 的 headers/库文件（已通过
  vcpkg 构建 `arm64-android` 静态库）。
- 首发仅支持 `arm64-v8a`；在稳定后再加入 `armeabi-v7a`。为 x86_64 模拟器提供独立的
  开发验证构建，不作为首发发布 ABI。
- 打开 `easyPlayerEngineEnabled`，构建 `libeasy_player_engine_android.so`，并验证 JNI
  `create/open/play/pause/stop/seek`。
- 验收：Gradle 能为目标 ABI 打包 JNI 库，应用启动时 `System.loadLibrary` 成功。

已验证：`arm64-v8a` 首发构建与 `x86_64` 模拟器构建均能生成并加载
`libeasy_player_engine_android.so`；JNI 库与 APK ZIP 对齐均通过 16 KB 校验。

### M2：Android 播放宿主与最小 UI（已完成）

- 以 `NativePlaybackService` 作为唯一 JNI 调用者，保留音频焦点、MediaSession 与前台通知。
- 将 `MainActivity` 从 Hello World 替换为本地文件选择、播放/暂停、进度与错误展示。
- 先支持本地文件路径；不接入下载、帐号或 Windows 设备选择。
- 验收：可选择 MP3、FLAC、WAV，执行播放、暂停、拖动、停止和重复打开。

已验证：x86_64 AVD 上可选择并播放本地歌曲，`NativePlaybackService` 已绑定且能创建
前台播放通知。

### M3：稳定性与发布准备（进行中）

- 覆盖后台播放、耳机/蓝牙路由变化、来电/焦点丢失、横竖屏与进程重建。
- 验证 DSP 的默认关闭状态和启用后的 CPU/卡顿表现。
- 增加 ABI、许可证、开源依赖来源与构建版本记录。
- 验收：真机连续播放、反复打开关闭和常见路由切换均无崩溃或明显爆音。

## 当前状态与后续顺序

当前没有构建阻塞项。后续按以下顺序推进：

1. 真机/模拟器回归：重复打开关闭、后台播放、通知操作、耳机或蓝牙路由切换、音频焦点丢失。
2. 发布构建：固定首发 `arm64-v8a`，将 `x86_64` 保留为模拟器开发 ABI；补齐依赖版本与许可证清单。
3. 产品 UI：替换当前最小控件，增加播放队列、封面与媒体信息、音效参数，以及 Flutter 迁移边界。

## 每次改动后的验证

```powershell
cd android-app
.\\gradlew.bat :app:assembleDebug --no-daemon
```

启用引擎后，另外执行：

```powershell
.\\gradlew.bat :app:externalNativeBuildDebug --no-daemon
```

在当前 x86_64 模拟器上，`local.properties` 已选择 `x64-android` 依赖与 `x86_64` ABI。
构建 arm64 首发包时覆盖这两个值：

```powershell
.\\gradlew.bat :app:assembleRelease `
  -PeasyPlayerAndroidAbis=arm64-v8a `
  -PeasyPlayerAndroidDepsRoot=D:/program/vcpkg/installed/arm64-android
```
