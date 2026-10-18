# DSP 管线开发计划（含 Bit-Perfect 真实性约束）

## 目标与边界

本阶段在已有的 Decoder → Ring Buffer #1 → AudioBackend 链路中，加入一个可旁路、无实时锁、可观测的 PCM DSP 管线。

- 输入与内部格式固定为 **interleaved f32 PCM**。
- 管线只处理 PCM；DSD Native / DoP 不经过该管线。
- 引擎仍只接收文件路径，不引入曲库职责。
- 任意改变样本值、采样率、声道路由或输出格式的节点，都必须使 `isBitPerfect=false`。

## Bit-perfect 的定义与判定

`isBitPerfect=true` 不是“音质模式”，而是一次可审计的输出结论。只有同时满足下列条件才允许为真：

1. 输入为 PCM，且 decoder 输出的样本格式、采样率、声道数被后端原样接受；
2. 后端为 WASAPI Exclusive 或 ASIO；
3. ReplayGain、音量衰减/增益、EQ、所有 DSP 节点、重采样、声道平衡/路由、速度、crossfade 全部关闭；
4. 管线走 `memcpy` 旁路，未进行 dither、格式变换或混音；
5. 后端报告的实际格式与源轨道格式完全一致。

WASAPI Shared、DirectSound、DSD→PCM、DoP 和 Native DSD 都不得报告 PCM bit-perfect；DSD 应在后续单独增加 `nativeDsd`/`dop` 状态，不能滥用此布尔值。

当前 f32 输出路径尚未具备经验证的原始 PCM 直通实现，因此状态会保守地报告 `isBitPerfect=false`。为避免把“条件满足”误作“已验证”，状态额外上报 `isBitPerfectEligible` 与 `bitPerfectVerificationState`：`blocked`（存在软件/输出条件 blocker）、`eligible_unverified`（软件条件满足，仍需要留存的 DAC/loopback 逐样本验证）和 `verified`。在原生格式直通与硬件验证完成前，绝不显示为 true。

## 运行时模型

```text
Decoder (f32, source format)
  → Ring Buffer #1
  → Audio callback
      ├─ BitPerfectBypass: memcpy → Backend
      └─ DspPipeline: ReplayGain/Preamp → EQ → ordered DSP Nodes → Limiter → Master volume
                      → Resampler → Channel Matrix
                      → Channel Matrix → Backend
```

音频回调只能读取已构建的 live 参数并处理预分配缓冲区：不得分配内存、获取锁、写日志、调 JS 或做磁盘 I/O。控制线程写入 pending 参数后设置原子 dirty 标记；回调起始处原子交换 live/pending 配置。需要重新分配或重新初始化的操作（例如改变 EQ 段数、重采样器规格）在控制线程构建好新对象，再于回调边界无锁切换。

## 分阶段实施

### P3.0：管线骨架与可观测性

新增 `dsp_pipeline.h/.cpp` 与链路状态结构：定义 `ProcessContext`、固定容量工作缓冲、节点启用状态和 `AudioChainStatus`。先实现只有 bypass 的管线，并在 `audioChainChanged` 中上报：源格式、实际后端格式、节点列表、旁路原因、`isBitPerfect` 与拒绝原因列表。

验收：不启用节点时输出与当前版本一致；Exclusive/ASIO 且格式一致时状态会列出全部前置条件，但在原生直通和硬件验证完成前仍保持 `false`；任一否决条件都能在 UI/日志中看到具体原因。

### P3.1：增益与 ReplayGain

实现 ReplayGain 节点和用户音量节点。二者默认关闭或 1.0；只要有效增益不等于 1.0，就撤销 bit-perfect。增益变更使用双缓冲参数，不在回调内重建对象。

验收：增益切换无爆音、无回调分配；状态从 true 到 false 和恢复的原因准确。

当前实现：已提供手动 Preamp dB 控制（-24 至 +24 dB）与主音量节点；二者都在管线内进行回调内单 buffer 平滑、经 IPC/UI 控制并上报 bit-perfect 否决原因。音轨标签读取与 album/track ReplayGain 策略留待元数据阶段接入。

补充实现：Decoder 现在从容器与音频流元数据读取 `REPLAYGAIN_TRACK_GAIN`、`REPLAYGAIN_ALBUM_GAIN` 及对应 Peak。ReplayGain 支持 Off / Track / Album 策略，并可启用 Peak 保护：最终增益不超过使标记 Peak 保持在 0 dBFS 的上限。没有匹配标签时安全旁路，不会把策略选择误报为激活；生效时位于 Channel Matrix 后、手动 Preamp 前，并明确列为 bit-perfect blocker。

### P3.2：参数均衡器

实现最多 20 段 Biquad PEQ。控制线程计算系数并生成完整 immutable 配置，音频线程在 buffer 边界切换；新增系数平滑或短交叉淡化以避免参数突变带来的 click。

验收：全段 bypass 时严格走 `memcpy`；任何一段启用即撤销 bit-perfect；扫频、脉冲和参数频繁修改下无崩溃、无明显爆音。

当前实现：已接入 20 段 peaking Biquad、每声道独立状态、不可变系数配置的原子发布及 20 段基础面板。系数切换时会清空滤波器状态；后续将替换为短交叉淡化并开放每段 Q 与频率编辑。

### P3.3：重采样与声道矩阵

接入 libsamplerate；仅当源格式与目标格式不一致且用户明确允许时启用。声道平衡、路由和 downmix 用独立 channel-matrix 节点表达，不隐藏在后端。所有重采样/矩阵操作均否决 bit-perfect。

验收：后端协商格式变化后链路状态能说明“为何重采样”；不同声道数不会越界；源格式直接被后端接受时不实例化重采样器。

依赖状态：已采用文档指定的 libsamplerate（本地 vcpkg `x64-windows` 安装），下一步接入 `SRC_STATE` 与自建声道矩阵。

### P3.4：通用 DSP 节点与配置持久化

定义稳定的 `DspNode` 接口和预分配要求；先加入 Compressor、Delay、Reverb、Chorus、Noise Gate、Phaser 的空壳/旁路，再逐个实现。配置以版本化 JSON 持久化，但加载、解析和对象构建只发生在控制线程。

验收：节点可独立启停与排序；损坏配置可恢复默认；管线状态与实际启用节点一致。

### P3.5：Limiter 与 Modulation

Limiter 固定在有序 DSP 节点链之后、主音量之前。它采用逐帧峰值检测、瞬时压低与可调 release；关闭时完全旁路。其作用是控制 DSP 叠加可能产生的峰值，而不是宣称 true-peak 或 look-ahead brickwall 限制。

Modulation 的第一项为 Chorus：独立于 Delay/Reverb 的短延迟环形缓冲，以 LFO 调制读取位置并线性插值。控制参数为 `rateHz`（0.05–10 Hz）、`depthMs`（0.1–15 ms）与 `mix`（0–1）。缓冲在格式配置时预分配；回调内只读取不可变配置、更新相位和缓冲，不得分配、加锁、写日志或调用 JS。Chorus 可在 DSP 节点链中排序，启用时必须列入 `activeNodes` 和 bit-perfect blockers。

### P3.6：Noise Gate / Expander

Noise Gate 是有序 DSP 节点链中的动态节点，使用全部声道的峰值作联动检测，因此不会因左右声道分别开关而改变声像。参数包括 `thresholdDb`（-80–0 dB）、`attackMs`（0.1–200 ms）、`holdMs`（0–2000 ms）、`releaseMs`（5–2000 ms）和 `rangeDb`（-100–0 dB）。信号高于阈值时以 Attack 打开；低于阈值后先保持 Hold，再以 Release 向 Range 指定的最低增益收敛。`rangeDb=0` 可作为只观测、不衰减的安全旁路式配置，但节点启用本身仍不得声称 bit-perfect。

运行时系数和 Hold 帧数只在控制线程构建并以不可变快照发布；音频回调只做峰值检测、原子读取和乘法，不分配、不加锁、不写日志。启用节点必须列入 `activeNodes` 与 bit-perfect blockers；版本化配置需从旧的四节点顺序自动追加默认关闭的 Noise Gate。

验收：双声道任一声道超过阈值时，两声道同步打开；静音或低电平段在 Hold 后平滑下降到 Range；连续调节阈值、Attack、Hold、Release 和 Range 不产生爆音；重启后参数、顺序和开关状态保留。

### P3.7：Phaser

Phaser 是有序 DSP 节点链中的四级一阶全通滤波器调制效果，不复用 Chorus/Delay 的延迟缓冲。每个声道拥有独立滤波状态，但共享同一个 LFO，相同的扫频轨迹能保持立体声像稳定。参数为 `rateHz`（0.05–10 Hz）、`depth`（0–1 octave sweep）、`centerHz`（100–5000 Hz）、`feedback`（-0.95–0.95）与 `mix`（0–1）。反馈只使用前一采样点的 wet 输出，且严格限幅在稳定范围内。

频率相关的一阶全通系数在音频回调中随 LFO 连续更新；实现不得分配、加锁、写日志或调用 JS。重置、换曲或重新配置输出格式时必须清空 Phaser 的滤波状态、反馈和相位。Phaser 启用时必须显示在 `activeNodes`，并作为明确的 bit-perfect blocker。

验收：持续音下可听到由 Rate、Depth 与 Center 共同决定的相位扫动；Feedback 改变峰谷的强调程度但不自激；关闭、换曲与格式切换后不存在残留拖尾或尖锐蜂鸣；参数和节点顺序经重启后恢复。

### P3.8：Channel Matrix（平衡与基础路由）

Channel Matrix 位于重采样和自动声道数转换之后、Preamp/EQ 之前。默认关闭时仅执行必要的声道数适配；启用后可应用左右平衡、L/R 交换、立体声合单声道，以及最多 8 个输出声道的独立增益（0–2）。它使用不可变配置快照，回调内只做每帧样本变换，不分配、不加锁。任意控制启用均改变样本，必须作为 bit-perfect blocker；源与后端声道数不同导致的自动适配同样不可声称 bit-perfect。

验收：Balance 在 -1 与 +1 时分别静音右、左声道；Swap L/R 严格交换立体声样本；Stereo to mono 将左右平均后同时输出到两声道；每个输出声道增益独立且限幅在 0–2；关闭后不再施加用户矩阵控制，重启后配置可恢复。

### P3.9：保音高播放速度

播放速度使用 SoundTouch 的 tempo 处理而非重采样，因此在 0.5–2.0× 范围内保持音高。该阶段位于采样率转换后、Channel Matrix 前：音频回调按速度比例从源 FIFO 请求帧，SoundTouch 输出固定的后端回调帧数。算法启动和参数切换产生的固有延迟以静音填充，不能阻塞回调或回退为变调重采样。SoundTouch 的内部 FIFO 在输出格式配置时预热；启用且速度非 1.0× 时必须作为 bit-perfect blocker。

验收：0.5×、1.0×、1.5×、2.0× 下节奏长度按预期改变、音高不随速度变化；切换速度不崩溃且无持续爆音；关闭后恢复 1.0× 直通；重启后开关与速度值恢复。

验收：启用 Chorus 后，持续音可听到随 Rate/Depth 变化的调制；参数更新不产生爆音或蜂鸣；关闭节点后输出不再写入 Chorus 历史；重启后节点顺序、启用状态和参数从版本化配置恢复。Limiter 或任一 Modulation 节点启用时，`isBitPerfect` 必须保持 `false`，且给出明确 blocker。

## API 与状态

新增 IPC 命令：`getAudioChain`、`setReplayGain`、`setEqBands`、`setDspNodes`、`setResampler`、`setChannelMatrix`。新增事件 `audioChainChanged`，其负载至少包含：

```ts
interface AudioChainStatus {
  sourceFormat: AudioFormat
  backendFormat: AudioFormat
  activeNodes: string[]
  bypassedNodes: string[]
  isBitPerfect: boolean
  isBitPerfectEligible: boolean
  bitPerfectVerificationState: 'blocked' | 'eligible_unverified' | 'verified'
  bitPerfectBlockers: string[]
}
```

UI 必须展示 blockers，而不是只显示绿色的 bit-perfect 标签。

## 验证与发布门槛

1. 单元测试：判定矩阵、Biquad 系数、声道矩阵、旁路样本逐位比较。
2. 离线链路测试：输入 PCM 与 bypass 输出逐样本比较；节点启用后验证输出变化符合预期。
3. 后端集成测试：WASAPI Shared/Exclusive、ASIO、DirectSound 各跑一轮格式协商和状态断言。
4. 实时测试：256/128/64 frames 下循环切换参数，记录 underrun、callback 耗时 P99 和回调内分配次数。
5. bit-perfect 验证：为支持的 DAC 建立 loopback/设备验证流程；软件断言只能证明“链路条件满足”，不能替代硬件端逐样本验证。

只有通过 1–4，且目标设备的第 5 项验证留档后，才可在产品中把对应后端/格式组合标为“已验证 bit-perfect”。
