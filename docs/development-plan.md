# Easy-Player 开发计划

## Context

将 easy-player（Electron + Vue 3 + TypeScript 脚手架）打造为面向专业用户的本地音频播放器。核心目标：**完成音频引擎加上简单的页面验证**。当前项目为空模板，无任何音频功能。

## 技术选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 框架 | Electron 39 + Vue 3 + TS | 已搭建 |
| 原生引擎 | C++ Node-API addon | ASIO/WASAPI Exclusive/bit-perfect 必须原生 |
| 音频 I/O | **自实现** (WASAPI / ASIO / DirectSound) | 直接调用 Windows COM API，完全控制缓冲区、线程、bit-perfect 路径 |
| 解码 | FFmpeg libavcodec (LGPL, 动态链接) | 全格式 + DSD |
| 重采样 | libsamplerate (BSD) | 多质量等级 |
| FFT | kissfft (BSD) | 轻量 |
| 构建 | cmake-js + node-gyp | Electron 原生模块 |
| UI 组件 | 自定义 CSS + Canvas | 第一阶段仅验证 |
| 状态管理 | Pinia | Vue 3 官方 |

自实现 vs 用 miniaudio：专业播放器（foobar2000、JRiver）均直接调 API，以获得线程控制、缓冲区直接访问、DSD Native 传输能力。

## 架构概要

```
渲染进程 (Vue 3)              主进程 (Electron)               原生插件 (C++)
┌────────────────┐  IPC  ┌──────────────────────┐  N-API  ┌──────────────────────┐
│ PlayerControls │◄─────►│ AudioEngineManager   │◄───────►│ AudioEngine           │
│ ProgressBar    │       │ ipc-handlers.ts      │        │                      │
│ DeviceSelector │       │ types.ts             │        │ DecoderThread        │
│ TrackInfo      │       └──────────────────────┘        │   FFmpeg → f32 PCM   │
│ LogViewer      │                                        │        │             │
│                │                                        │ Ring Buffer #1       │
│ Pinia Stores   │                                        │   (无锁 SPSC)        │
└────────────────┘                                        │        │             │
                                                          │ ┌──────▼──────────┐ │
                                                          │ │  DSP Pipeline    │ │
                                                          │ │ RG→EQ→DSP→重采样 │ │
                                                          │ │ →声道平衡        │ │
                                                          │ └──────┬──────────┘ │
                                                          │        │             │
                                                          │ ┌──────▼──────────┐ │
                                                          │ │ BIT-PERFECT     │ │
                                                          │ │ BYPASS (全部DSP │ │
                                                          │ │ 关闭时走这条)    │ │
                                                          │ └──────┬──────────┘ │
                                                          │        │             │
                                                          │ ┌──────▼──────────┐ │
                                                          │ │ AudioBackend     │ │
                                                          │ │ (自实现)         │ │
                                                          │ │ • WasapiBackend  │ │
                                                          │ │ • AsioBackend    │ │
                                                          │ │ • DSoundBackend  │ │
                                                          │ └──────┬──────────┘ │
                                                          │        │             │
                                                          │   Analysis Tap      │
                                                          │        │             │
                                                          │ Ring Buffer #2      │
                                                          │   → AnalysisThread  │
                                                          │     (FFT / LUFS)    │
                                                          └──────────────────────┘
```

**核心设计决策：**
1. 引擎只接收文件路径，不参与曲库管理
2. 四线程：解码、音频（实时）、分析、位置定时器
3. 三个 Audio I/O 后端自实现，统一抽象接口
4. Bit-perfect = EQ/DSP/RG/重采样/声道平衡全关 + WASAPI Exclusive 或 ASIO
5. 每个 DSP 节点可独立旁路

---

## 音频链路设计

### 完整信号路径

```
File Path (string)
    │
    ▼
DecoderThread: FFmpeg 解码 → interleaved f32, 源采样率, 立体声
    │
    ▼
Ring Buffer #1 (无锁 SPSC, 4×8192 frames, ~750ms)
    │
    ▼
AudioThread (实时, MMCSS Pro Audio 优先级)
    │
    │  从 Ring Buffer #1 读取 → 判断信号路径:
    │
    ├── BIT-PERFECT 路径 (条件全部满足时):
    │   RG off ∧ EQ off ∧ DSP off ∧ Resampler off ∧ Channel Balance off
    │   ∧ Backend ∈ {WASAPI Exclusive, ASIO}
    │   → memcpy(input, output) 直达后端, isBitPerfect = true
    │
    └── DSP 路径:
        [ReplayGain] → [Parametric EQ (20段 Biquad)] → [DSP Nodes (Comp/Reverb/Delay/...)]
        → [Resampler (libsamplerate, 3级质量)] → [Channel Balance (per-channel gain + routing)]
        → 输出到 Backend
    │
    │  Analysis Tap: 在 DSP 出口 try_write → Ring Buffer #2 (失败丢弃, 不阻塞)
    │
    ▼
AudioBackend::callback → 硬件输出

  WasapiBackend:               AsioBackend:              DSoundBackend:
  IAudioRenderClient           bufferSwitch()             IDirectSoundBuffer
  ::GetBuffer/ReleaseBuffer    直接填充 ASIO buffer       ::Lock/Unlock
```

### DSD 三路径

```
DSD 文件 (DSF/DFF/ISO)
    │
    ├── Native DSD: ASIO + DAC 支持 → 原始比特流 → ASIO DSD buffer
    ├── DoP: WASAPI Exclusive/ASIO + 24-bit → 0x05/0xFA 标记 → 24-bit PCM 帧
    └── DSD→PCM: sigma-delta 解调 → PCM64 → 降采样 → 进入 DSP Pipeline
```

### 链路格式约定

- **Decoder 输出**: interleaved f32, 源采样率
- **DSP Pipeline**: 全程 interleaved f32
- **Resampler**: 源采样率 → 后端采样率（同采样率时旁路）
- **Backend 内部**: f32 → 设备原生格式 (s16/s24/s32)

---

## Audio I/O Backend 设计

### 抽象接口

```cpp
class AudioBackend {
public:
    virtual ~AudioBackend() = default;
    virtual std::vector<DeviceInfo> enumerate_devices() = 0;
    virtual AudioFormat open(const std::wstring& device_id,
                             const AudioFormat& requested,
                             AudioCallback callback) = 0;  // callback = int(float* output, int frames, int channels)
    virtual bool start() = 0;
    virtual bool stop() = 0;
    virtual void close() = 0;
    virtual BackendType type() const = 0;
    virtual AudioFormat current_format() const = 0;
    virtual int buffer_size_frames() const = 0;
};
```

### 三个实现

| Backend | 核心 API | 线程模型 | 关键点 |
|---------|---------|---------|--------|
| **WasapiBackend** | `IMMDeviceEnumerator` → `IAudioClient` → `IAudioRenderClient` | 自创建线程 `WaitForSingleObject(hEvent)` + MMCSS | Shared: 自动格式协商; Exclusive: `AUDCLNT_SHAREMODE_EXCLUSIVE`, 绕过 APO |
| **AsioBackend** | 注册表扫描 CLSID → `LoadLibrary` → 自声明 IASIO 接口 | `bufferSwitch()` 回调，线程由驱动管理 | 不依赖 Steinberg SDK; 支持 DSD Native capability 检测 |
| **DSoundBackend** | `DirectSoundCreate8` → `IDirectSoundBuffer` + notify | Windows 音频服务线程 | Fallback，现代 Windows 内部模拟为 WASAPI Shared |

### WASAPI Exclusive 初始化流程

```
CoInitializeEx(MULTITHREADED)
→ IMMDeviceEnumerator::GetDevice(id)
→ IMMDevice::Activate(IID_IAudioClient)
→ IAudioClient::IsFormatSupported(EXCLUSIVE, &fmt, &closest)
→ IAudioClient::Initialize(EXCLUSIVE, EVENTCALLBACK, hnsPeriod, hnsPeriod, &fmt)
→ IAudioClient::GetBufferSize(&frames)
→ IAudioClient::SetEventHandle(hEvent)
→ IAudioClient::GetService(IID_IAudioRenderClient)
→ IAudioClient::Start()
→ 循环: WaitForSingleObject → GetCurrentPadding → GetBuffer → callback() → ReleaseBuffer
```

### ASIO 驱动加载流程

```
RegOpenKey(HKLM\SOFTWARE\ASIO\{driver_name}) → 读取 CLSID
→ RegOpenKey(HKCR\CLSID\{clsid}\InprocServer32) → 读取 DLL 路径
→ LoadLibrary(dll_path) → GetProcAddress("GetAsioDriver") → 获取 IASIO*
→ IASIO::init(hwnd) → getChannels → getBufferSize → getSampleRate
→ createBuffers → 注册 bufferSwitch → start()
```

---

## 线程设计

### 线程拓扑和职责

```
┌── Node.js Event Loop ──────────────────────────────────────┐
│  IPC 收发 · AudioEngineManager · 调用 N-API · 转发事件到 UI   │
│  ⚠️ 不做任何音频处理                                         │
└────────────────────────────────────────────────────────────┘
        │ N-API 边界
        ▼
┌── DecoderThread ───────────────────────────────────────────┐
│  优先级: NORMAL                                             │
│  av_read_frame → avcodec_decode → swr_convert(planar→interleaved) │
│  → ring_buffer_1.write() → 满时 CV wait                     │
│  Seek: mutex 保护 av_seek_frame + 清空 ring buffer          │
└────────────────────────────┬───────────────────────────────┘
                             │ Ring Buffer #1 (无锁 SPSC)
                             ▼
┌── AudioThread (实时) ──────────────────────────────────────┐
│  优先级: MMCSS "Pro Audio" / ASIO 驱动高优先级              │
│  ⚠️ 硬约束: 不分配内存 · 不获取锁 · 不做 I/O                 │
│                                                             │
│  callback(float* output, int frames, int channels):         │
│    read = ring_buffer_1.read(buf, frames)  // underrun → 静音填充 │
│    if (is_bit_perfect) → memcpy(output, buf)                │
│    else → dsp_pipeline.process(buf, output)                 │
│    output *= atomic_volume                                  │
│    ring_buffer_2.try_write(output)  // 分析 tap, 失败丢弃    │
│    position_frames += frames  // atomic store               │
│    decoder_cv.notify_one()                                  │
│    return frames                                            │
└──────────────┬─────────────────────┬────────────────────────┘
               │ Ring Buffer #2       │ atomic position_frames
               ▼                      ▼
┌── AnalysisThread ──────┐  ┌── PositionTimer ───────────────┐
│  优先级: BELOW_NORMAL  │  │  优先级: NORMAL                 │
│  主循环 ~30Hz:         │  │  每 100ms:                      │
│   FFT → spectrum → JS  │  │   pos → ThreadSafeFunction → JS │
│   LUFS → loudness → JS │  │   为什么不用 AudioThread:        │
│   Sleep(33)            │  │   ThreadSafeFunction 内部有锁   │
└────────────────────────┘  └────────────────────────────────┘
```

### 同步原语矩阵

```
Decoder → Audio       Ring Buffer #1 (atomic) + CV     Audio 端永不阻塞, Decoder 端可 CV wait
Audio → Analysis      Ring Buffer #2 (atomic)          Audio 端 try_write, Analysis 端可阻塞
JS → Decoder (Seek)   std::mutex                       短暂阻塞解码线程 (不在音频线程)
JS → Audio (控制)     atomic + 双缓冲                   复杂参数用 pending/live 双缓冲, 回调边界 swap
Native → JS (事件)    N-API ThreadSafeFunction          在非音频线程中调用
```

### 音频线程参数无锁更新（双缓冲模式）

```
JS 线程:  memcpy(pending_.eq_bands, new_bands) → params_dirty_.store(true)
Audio 线程回调边界:
  if (params_dirty_.load()) {
    swap(live_.eq_bands, pending_.eq_bands)
    eq.rebuild_from_bands(live_.eq_bands)  // 仅参数变化时重建系数
    params_dirty_.store(false)
  }
  dsp_pipeline.process(input, output, frames)  // 使用 live_ 数据
```

### 状态机

```
IDLE → open(path) → LOADING → READY → play() → PLAYING ⇄ pause() ⇄ PAUSED
                       ↓ 失败              ↓ stop() / trackEnded / error
                     IDLE              STOPPED → IDLE → open(newPath)
```

### 关键时序

| 约束 | 值 |
|------|-----|
| Audio 回调时限 | < 缓冲区时长 (256f@48kHz=5.3ms, ASIO 64f=1.3ms) |
| Ring Buffer #1 目标占用 | 50-75% |
| Decoder 预读 | 2× Ring Buffer (~1.5s) |
| 位置推送 | 10Hz |
| 频谱推送 | 30Hz |
| Seek 延迟 | < 50ms |

---

## 分阶段路线图

### Phase 0：基础设施（第 1-2 周）
原生插件编译加载 + IPC 打通 + DirectSound 跑通首条音频通路。

| # | 任务 | 关键文件 |
|---|------|---------|
| 0.1 | cmake-js 工程 + `AudioBackend` 抽象接口 | `CMakeLists.txt`, `audio_backend.h` |
| 0.2 | **DSoundBackend**: 设备枚举 + buffer 创建 + notify + 静音填充 | `dsound_backend.cpp/h` |
| 0.3 | FFmpeg 解码 WAV → interleaved f32 | `decoder.cpp/h` |
| 0.4 | Ring Buffer #1 (无锁 SPSC + CV) | `ring_buffer.h` |
| 0.5 | N-API 包装: `open/play/pause/stop/getPosition` | `addon.cpp`, `audio_engine.cpp/h` |
| 0.6 | electron-vite externals + electron-builder extraResources | 配置 |
| 0.7 | Preload `window.audioAPI` + IPC | `preload/index.ts` |
| 0.8 | spdlog → JS → logStore | `logger.cpp/h` |

**验证**: `npm run dev` → 听到 WAV 正弦波 (DirectSound)。

### Phase 1：WASAPI + 核心播放（第 3-6 周）

| # | 任务 | 关键文件 |
|---|------|---------|
| 1.1 | **WasapiBackend** (Shared): COM 初始化、设备枚举、事件回调、MMCSS 优先级 | `wasapi_backend.cpp/h` |
| 1.2 | **WasapiBackend** (Exclusive): `IsFormatSupported`、格式协商 | 同上 |
| 1.3 | FFmpeg 全格式解码: FLAC/MP3/AAC/ALAC/Vorbis/Opus/WavPack/APE/AIFF | `decoder.cpp/h` |
| 1.4 | Seek (样本级) + 完整状态机 + 掉帧计数器 | `audio_engine.cpp/h` |
| 1.5 | 三后端统一 `enumerate_devices()` + 合并去重 | `audio_engine.cpp` |
| 1.6 | 运行时后端/设备切换 | `audio_engine.cpp` |
| 1.7 | 播放器 UI: 播放/暂停/停止、进度条、音量、设备选单、后端选单、曲目信息 | Vue 组件 |
| 1.8 | Pinia + audioBridge | `playerStore.ts`, `audioBridge.ts` |

**验证**: 拖入 FLAC/MP3/WAV → WASAPI Shared/Exclusive/DS 均可播放和切换。

### Phase 2：ASIO + Bit-Perfect + 无缝播放（第 7-10 周）

- **AsioBackend**: 注册表扫描、LoadLibrary、IASIO 接口、bufferSwitch 回调、DSD capability 检测
- Bit-perfect 标记逻辑 + 验证工具（回环逐样本比对）
- 无缝播放 `playNext(path)` + Crossfade (等功率曲线 0-30s)
- DSD→PCM 降级通路

### Phase 3-6（概览）

- **Phase 3**: DSP 管线 — EQ (20段参量+图示)、DSP 节点链 (Comp/Reverb/Delay)、ReplayGain、重采样、声道平衡、变速、配置持久化
- **Phase 4**: 分析可视化 — FFT 频谱/瀑布图、EBU R128 响度表、播放链路状态面板、日志查看器；新增节奏驱动 UI：在最终 PCM 后建立非阻塞 Analysis Tap，以输出样本时间戳驱动频谱、低频能量、onset、BPM、beat/downbeat 事件，供封面、背景和进度条节奏动画使用。

#### Phase 4 节奏驱动 UI 约束

1. Audio callback 仅向 SPSC Analysis Tap `try_write`；缓冲满时丢弃分析帧，不能等待、分配、加锁或调用 JS。
2. 分析线程负责 FFT、频谱通量、瞬态/onset、自适应阈值、BPM 与 beat/downbeat 预测；换曲、Seek、暂停和速度切换时重置或重新锁定。
3. 所有分析帧都携带最终输出 PCM 的样本时间戳。Renderer 以播放时钟和已知输出延迟进行补偿，避免视觉落后声音。
4. 频谱帧推送限制为 20–30 FPS；beat/downbeat 作为独立轻量事件。Renderer 只维护最新分析状态，不反向影响音频链或 bit-perfect 判定。
5. 提供节奏视觉开关、强度和减少动态效果选项；无数据、暂停或切歌时动画必须平滑衰减。
- **Phase 5**: DSD 深入与跨平台 — Native DSD、DoP、SACD ISO 解析、Mac CoreAudio、Linux ALSA、插件 API
- **Phase 6**: 打磨发布 — 性能优化、错误恢复、crash 报告、CI/CD、文档

---

## IPC API（Phase 0-1）

### 命令

```typescript
// channel: "audio:command"
"open"              { filePath: string }                    → TrackInfo
"play"              { startPosition?: number }              → void
"pause"             {}                                      → void
"stop"              {}                                      → void
"seek"              { positionMs: number }                  → void
"setVolume"         { volume: number }                      → void
"enumerateDevices"  {}                                      → DeviceInfo[]
"setDevice"         { deviceId: string }                    → void
"setBackend"        { backend: "wasapi_shared"|"wasapi_exclusive"|"asio"|"directsound" } → void
"getStatus"         {}                                      → PlaybackState
"getTrackInfo"      { filePath: string }                    → TrackInfo
```

### 事件

```typescript
// channel: "audio:event"
"stateChanged"        { state, trackInfo }
"positionChanged"     { positionMs, durationMs }      // 10Hz
"trackEnded"          { reason }
"deviceListChanged"   { devices: DeviceInfo[] }
"audioChainChanged"   { chain, isBitPerfect }
"logEntry"            { level, message, timestamp }
"error"               { code, message, recoverable }
```

### 预加载 API

```typescript
interface AudioAPI {
  open(filePath: string): Promise<TrackInfo>
  play(startPosition?: number): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
  enumerateDevices(): Promise<DeviceInfo[]>
  setDevice(deviceId: string): Promise<void>
  setBackend(backend: string): Promise<void>
  getStatus(): Promise<PlaybackState>
  getTrackInfo(filePath: string): Promise<TrackInfo>
  // 事件订阅 (返回取消订阅函数)
  onStateChanged(cb): () => void
  onPositionChanged(cb): () => void
  onTrackEnded(cb): () => void
  onDeviceListChanged(cb): () => void
  onAudioChainChanged(cb): () => void
  onLogEntry(cb): () => void
  onError(cb): () => void
}
```

---

## Phase 0-1 文件清单

```
src/main/native/
├── CMakeLists.txt
└── src/
    ├── addon.cpp                  # N-API 注册
    ├── audio_engine.cpp/h         # 核心引擎
    ├── audio_backend.h            # 抽象接口
    ├── wasapi_backend.cpp/h       # WASAPI Shared + Exclusive
    ├── asio_backend.cpp/h         # ASIO (Phase 2)
    ├── dsound_backend.cpp/h       # DirectSound
    ├── decoder.cpp/h              # FFmpeg 解码
    ├── ring_buffer.h              # 无锁 SPSC
    └── logger.cpp/h               # spdlog

src/main/audio-engine/
├── index.ts                       # AudioEngineManager
├── ipc-handlers.ts                # IPC handler 注册
└── types.ts                       # 共享类型

src/preload/index.ts               # window.audioAPI
src/renderer/src/
├── App.vue                        # 播放器布局
├── services/audioBridge.ts        # 类型化 IPC
├── stores/playerStore.ts
├── types/audio.ts
├── components/player/
│   ├── PlayerControls.vue
│   ├── ProgressBar.vue
│   ├── TrackInfo.vue
│   ├── VolumeControl.vue
│   ├── DeviceSelector.vue
│   └── BackendSelector.vue
└── components/common/LogViewer.vue

```

## 关键风险

| 风险 | 缓解 |
|------|------|
| ASIO 驱动兼容性 | 回退链: ASIO→WASAPI Exclusive→WASAPI Shared→DS; 加载失败自动降级并通知 |
| ASIO 许可 | 不随应用分发任何 Steinberg 代码; 运行时 `LoadLibrary` 加载用户驱动 |
| FFmpeg 许可 | 动态链接 LGPL 构建, 分发 DLL |
| WASAPI COM 线程模型 | MSDN 文档交叉验证每个 COM 调用, `CoInitializeEx(MULTITHREADED)` |
| 音频线程实时性 | 回调中无锁无分配; 双缓冲处理参数变更; WPR 验证抖动 |
| electron-vite + .node | externals + extraResources/asarUnpack; dev/prod 双模式测试 |

## 验证

**Phase 0**: `npm run dev` → 听到 DirectSound 正弦波; enumerateDevices() 返回设备列表; 日志面板有输出

**Phase 1**: WAV/FLAC/MP3 三后端自由切换; 进度条/Seek/暂停/恢复 正常; 热插拔设备触发事件; 不支持的格式显示错误
