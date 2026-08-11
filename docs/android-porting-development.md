# Easy Player Android 正式移植开发文档

> 状态：执行中  
> 更新：2026-08-05  
> 适用范围：`engine-core/`、`engine-android/` 与 `android-app/`

## 1. 目标与边界

Android 版本是以本地音乐播放为核心的独立客户端，而不是将 Electron 界面或 Windows 运行时搬到手机上。

- 复用跨平台 C++ 音频引擎，保持解码、播放状态、DSP 和音频链路的演进一致。
- Android 应用采用 **Flutter UI + Kotlin/Gradle 原生宿主**：Flutter 承担全部产品界面、导航和国际化；Kotlin 保留 Room、MediaStore、SAF、JNI 和前台播放服务。当前原生 Android 界面仅作为已验证的技术原型，逐步由 Flutter 替换。
- 首个正式版本覆盖本地音乐库、播放队列、后台播放与基础歌单；下载、Windows 声卡后端等不进入 Android 范围。
- Android 与 Windows 数据库各自维护，不直接共享 SQLite 文件；后续如有需要，以可版本化的导入/导出数据格式迁移用户数据。

## 2. 已完成的基础基线

| 项目 | 结果 |
| --- | --- |
| 工程拆分 | 已分为 `engine-core/`、`engine-windows/`、`engine-android/`、`android-app/`。 |
| Android 原生引擎 | CMake 编译 C++ 引擎，JNI 暴露 Kotlin 调用层，AAudio 输出。 |
| 依赖与 ABI | 当前已验证 `x86_64` 模拟器；发布目标为 `arm64-v8a`。FFmpeg、libsamplerate、SoundTouch 均按 ABI 构建。 |
| 最小播放链路 | 文档选择音频文件后可播放；`NativePlaybackService` 提供 MediaSession、通知、音频焦点和前台服务。 |
| 16 KB 兼容性 | 原生库链接使用 16 KB 页对齐；已完成 APK 对齐与设备启动复核。 |

这只是技术基线，不代表正式产品功能已完成。

## 3. 原有功能与 Android 目标实现

| 桌面现有能力 | Android 目标 | 策略 / 阶段 |
| --- | --- | --- |
| 本地目录扫描、文件夹树、移动文件恢复 | 通过 Storage Access Framework 选择文件或目录；保存 URI 授权；必要时结合 MediaStore。 | 平台替代，P1 |
| 歌曲、专辑、歌手、流派浏览与搜索 | Room + SQLite 保存媒体索引；以 `content://` URI 作为媒体定位，不假设任意绝对路径可读。 | 平台替代，P1 |
| 自建歌单、封面、标签 | Room 实体保存歌单、条目、标签及排序；封面进入应用缓存。 | 平台替代，P1/P3 |
| 当前队列、顺序/列表循环/单曲/随机、播放进度 | `PlaybackRepository` 持久化队列和会话；`NativePlaybackService` 是唯一播放控制入口。 | 平台替代，P1/P2 |
| 播放历史、最近播放 | Room 保存去重最近播放与逐次播放记录。 | 平台替代，P2 |
| FFmpeg 解码、重采样、音量、倍速、均衡器、ReplayGain | 继续经 `engine-core` 与 JNI 配置；UI 仅调用 Android 引擎门面。 | 复用，P2 |
| DSP：压缩、延迟、混响、合唱、噪声门、移相等 | 保留引擎能力；先提供稳定的开关与参数存储，再逐项开放正式 UI。 | 复用，P4 |
| 无缝播放、交叉淡化、频谱/节拍分析 | 依赖队列预加载和 Android 设备性能验证；不作为首版门槛。 | 延后，P4 |
| 歌词读取、网络搜索、桌面歌词窗口 | 当前读取 FFmpeg 可见的内嵌 `syncedlyrics` / `lyrics` 标签，并在应用内按 LRC 时间轴同步；网络歌词须确认服务授权；悬浮桌面歌词不作为首版能力。 | P3 / 部分延后 |
| 元数据读取、封面提取、编辑标签 | 读取用引擎/Android 媒体 API；封面缓存。写标签受 SAF、格式和写入权限限制，后置单独设计。 | 读取 P1，写入 P3 |
| 网络音乐源、远程缓存与同步 | 仅在取得稳定且有授权的服务接口后设计；缓存遵循 Android 存储配额和离线策略。 | 延后，P5 |
| URL 解析、yt-dlp 下载、下载任务管理 | 不移植。该能力保持 PC 独占。 | PC 独占 |
| WASAPI 共享/独占、ASIO、DirectSound、输出设备选择、DoP | Android 使用系统音频路由和 AAudio；不提供 Windows 驱动模型或手工声卡后端。 | Windows 独占 |
| 系统托盘、迷你窗口、全局快捷键、开机自启、窗口控制 | 分别由媒体通知、锁屏控件、系统媒体按键替代；其余不移植。 | 平台替代 / PC 独占 |
| 桌面自动更新、显示资源管理器文件、系统字体目录 | 交给 Google Play/应用安装流程和 Android 文件选择器；不复制桌面系统控制。 | 平台替代 / 不移植 |

## 4. Android 目标架构

```text
mobile/easy_player_ui/
  lib/                Flutter 路由、状态、页面、组件、l10n
  android/            Flutter module 产物；由 android-app 宿主接入
android-app/
  app                 Kotlin Android 宿主、FlutterEngine、Platform Channel
  data                Room、SAF/MediaStore、封面缓存、仓库实现
  playback            PlaybackRepository 与 NativePlaybackService 的应用门面
          │ JNI
engine-android/       Kotlin 接口、媒体会话、AAudio、CMake
          │
engine-core/          解码、播放队列、DSP、重采样等跨平台 C++ 能力
```

架构约束：

1. Flutter UI 不直接管理 JNI 对象，也不直接持有音频线程。
2. 播放命令与状态统一经 `NativePlaybackService` / `PlaybackRepository`，使 Flutter、通知、耳机按键和未来小组件保持一致。
3. Flutter 通过 `MethodChannel("com.huiiro.easyplayer/library")` 请求扫描、查询资料库、歌单和队列；通过 `MethodChannel("com.huiiro.easyplayer/playback")` 发出播放命令；通过 `EventChannel("com.huiiro.easyplayer/playback/state")` 接收播放状态。频道负载使用版本化 JSON，禁止透传 JNI 指针或文件绝对路径。
4. 数据层只保存可再次访问的 `content://` URI、媒体指纹和缓存路径；失效授权必须能提示用户重新授权。
5. Windows 适配代码不得进入 `engine-core/`；Android API 不得反向依赖 Electron 目录。

## 4.1 Flutter UI 与交互规范

### 页面结构

```text
Scaffold
├─ Drawer（侧滑导航）
│  ├─ 音乐库：首页 / 歌曲 / 专辑 / 歌手 / 流派
│  ├─ 我的：歌单 / 最近播放 / 设置
│  └─ 工具：扫描系统媒体库 / SAF 补充导入 / 扫描状态
├─ 主内容区（仅当前页面内容）
└─ BottomPlayerBar（固定显示）
   └─ 点击 → PlayerPanel
      ├─ 默认页：封面、标题、艺术家、播放进度、主控制
      ├─ 左滑：详细信息（格式、采样率、比特率、专辑、文件来源）
      └─ 右滑：同步歌词；无歌词时显示明确空状态
```

### 交互约束

- 主界面不放扫描、导入、服务调试等全局操作；这些统一收纳至 Drawer，底部播放器始终可见。
- Drawer 顶部显示当前媒体库统计，扫描入口显示最近扫描时间和进行状态；扫描过程可取消，完成后刷新当前列表。
- `BottomPlayerBar` 显示封面缩略图、标题/艺术家、播放队列入口和唯一的播放/暂停按钮；在底栏向左滑为下一首、向右滑为上一首，点击非控制区域打开 `PlayerPanel`。
- `PlayerPanel` 以全屏高度显示，不保留顶部空白；使用三页 `PageView`：初始页为封面、基本信息、播放进度和 seek；向左滑至详细信息，向右滑至歌词。主控制（上一首、播放/暂停、下一首）固定为一行，播放模式、播放队列、音频操作入口（EQ/DSP）和更多功能独立为下一行。
- 从曲库点歌时以当前曲库建立完整播放队列；原生引擎从播放状态转为停止时识别为播放完成，并按当前模式自动切换下一首。顺序模式在队列末尾停止，其余模式依各自规则处理。
- Drawer 从屏幕左边缘向右滑即可打开；所有全局操作继续留在 Drawer，避免占用内容页空间。
- 播放器控制只发送意图，所有实际状态以原生 EventChannel 推送为准，避免 Flutter 本地状态与通知不同步。

### 歌词来源与时间轴

- `engine-core` 从容器或音频流的 `syncedlyrics`、`lyrics`、`unsyncedlyrics` 等内嵌标签读取原始文本，经 Android JNI 与 `library` Channel 的 `getEmbeddedLyrics(songId)` 返回。当前不扫描同目录 LRC，也不发起网络请求。
- Flutter 的 `LyricsSource` 是来源抽象；当前仅注册 `EmbeddedLyricsSource`。未来网络来源必须实现同一接口并返回 `LyricsDocument`，不得让 UI、播放服务或 JNI 依赖具体服务商。
- `LyricsDocument` 统一解析 LRC 时间戳、多时间标签与 `offset`；播放状态的 `positionMs` 是唯一同步时钟。无时间戳的内嵌文本仍可阅读，但不进入逐行跟随模式。

### 国际化（i18n）

- 使用 Flutter `gen-l10n` 与 ARB 文件，首批提供 `zh_CN` 和 `en`；所有用户可见字符串必须进入 ARB，禁止在 Dart Widget 中硬编码。
- 原生 Kotlin 的权限说明、MediaSession 文案和通知也使用对应 Android string 资源；频道传递的是语义错误码，Flutter 按 locale 显示文案。
- 歌曲标题、艺术家、歌词和用户创建内容不翻译；日期、时长和数字使用当前 locale 格式化。
- 主题设置支持浅色、深色与跟随系统，并持久化到 Android `app_setting`；所有新增动效须同时遵守“减少动画”设置。开启后关闭非必要的列表高亮、页面/底栏过渡，以降低渲染开销；播放、拖动和错误提示等功能语义不得依赖动画。
- 歌曲、最近播放、歌单列表、歌单详情、设置与扫描页面统一采用右侧滑入的内容过渡；“减少动画”开启时取消过渡。设置和媒体库扫描是独立主页面，不再以 Drawer 内操作或临时底部面板呈现。
- 操作成功、重复添加和失败提示采用当前 `ColorScheme` 的悬浮圆角反馈，不使用阻断式弹窗或固定深色提示条。

## 5. 阶段计划与验收标准

### P0：工程与引擎基线（已完成）

- Kotlin/Gradle 工程可在 Android Studio 打开、编译并安装。
- x86_64 模拟器能够选择本地文件并播放。
- JNI 原生库满足 16 KB 页兼容要求。

### P1：本地资料库与基础播放体验

状态：进行中。已建立 Room v1 数据库，并已实现 MediaStore 自动扫描、单文件/目录的 SAF 补充导入、URI 持久授权、基础元数据读取，以及持久化队列的上一首/下一首原型。`PlaybackRepository` 已从 `MainActivity` 抽出，统一管理当前歌曲、队列导航、文件物化与对前台播放服务的调用。Flutter UI module、Drawer、手势底部播放器、全屏三页播放器面板与 `en/zh/zh_CN` i18n 骨架已完成；其源码模块已接入 Kotlin 宿主，`library`、`playback` 和 `playback/state` 频道已接通。底栏包含队列入口，播放器显示进度、总时长并可拖动 seek；音频内嵌封面会提取至应用缓存后在列表、底栏和播放器中显示。最后曲目、位置及播放模式写入 Room 设置表，重启后恢复已打开曲目及进度但不自动播放。已实现顺序播放、列表循环、单曲循环、随机四种模式，以及去重的最近播放记录；播放器按钮循环切换模式，Drawer 可打开最近播放。基础歌单现可在 Drawer 中查看、创建、打开详情，并从歌曲更多面板添加曲目；歌单详情支持从更多菜单移除歌曲与长按拖拽排序，变更写入 Room。重复添加会给出统一的悬浮反馈。专辑与歌手采用可配置列数的封面卡片，并支持进入详情页；全局搜索按歌曲标题、歌手和专辑即时匹配，搜索结果播放时替换为结果队列。设置页支持浅色、深色、跟随系统和减少动画，且配置持久化到 Room。模拟器已验证 Flutter 列出 8 首 MediaStore 歌曲、生成 8 个封面缓存、播放后重启仍恢复同一曲目、创建歌单后显示名称与曲目数，并可启动原生引擎播放。下一步为物理媒体删除的系统确认流程，以及更完善的资料库筛选。

交付内容：

- 引入 Room，建立 `song`、`playlist`、`playlist_item`、`tag`、`history`、`app_setting` 等 Android 实体和迁移机制。
- 以 MediaStore 自动扫描系统音频为默认入口；SAF 用于补充导入单文件与目录。扫描后读取标题、歌手、专辑、时长、格式、封面等元数据。
- 提供歌曲列表、歌单列表与创建；完成歌单详情、添加/移除/排序歌曲，随后补充专辑/歌手入口与搜索。
- 用持久化队列替换临时的单文件播放 UI；支持上一首、下一首、四种播放模式和重启恢复。
- 建立 Flutter module 并完成 Drawer、歌曲列表、固定底部播放器、三页播放器面板与中英文 i18n 骨架；原型 Kotlin UI 不再继续扩展。

验收：授权目录重启应用后仍可浏览；至少 200 首本地文件扫描不阻塞主线程；从列表、通知和耳机按键操作时状态一致。

### P2：播放控制与系统集成

交付内容：

- 完善锁屏/通知媒体控件、音频焦点、耳机拔出、蓝牙路由与播放服务恢复策略。
- 完成音量、进度、倍速、基础均衡器、ReplayGain、最近播放和播放历史。
- 统一处理解码失败、URI 失效、存储授权失效和音频输出错误。

验收：前后台切换、锁屏、电话/其他音频打断与恢复符合 Android 音频焦点预期；连续播放 30 分钟无服务或资源泄漏异常。

### P3：内容体验

交付内容：

- ~~应用内逐行内嵌歌词读取与时间轴同步。~~ 已完成内嵌标签读取、LRC 解析与逐行高亮；本地侧载 LRC 与网络歌词来源后续接入。
- 标签、批量管理、元数据刷新；评估并实现受支持格式的标签写入。
- 在合法授权前提下评估网络歌词和远程源。

验收：歌词与播放进度同步；标签/歌单/封面修改重启后保留；无文件写入授权时给出明确说明且不损坏原文件。

### P4：高保真与高级音效

交付内容：

- 渐变过渡、无缝播放、预加载与频谱数据通路。
- 按设备性能逐步开放 DSP 节点、重采样配置、声道矩阵和 limiter。
- 为每个高级音效提供默认值、开关、性能保护和故障降级。

验收：中端真机连续切歌无明显爆音；开启/关闭 DSP 不导致 ANR、崩溃或不可恢复的音频焦点状态。

### P5：发布准备

- 以 `arm64-v8a` 真机作为发布验收主目标；`x86_64` 仅保留模拟器调试。
- 自动化执行 Debug/Release 构建、JNI 加载测试、16 KB 对齐检查和基础播放回归。
- 完成隐私说明、存储权限说明、开源组件许可证及 FFmpeg 发行合规审查。

验收：全新安装、升级安装、授权拒绝和授权恢复均可用；在目标 Android 版本与真实设备完成回归。

## 6. 接下来立即执行的工作包

从 P1 开始，按以下顺序实现，避免先做界面而没有可靠数据和播放状态：

1. 建立 Android `data` 模块与 Room v1 schema，先覆盖歌曲、歌单、队列、历史和设置。
2. 实现 SAF 导入与后台元数据扫描，将现有“选择后直接播放”改为入库后播放。
3. ~~定义 `PlaybackRepository`，把队列从 Activity 移到播放边界。~~ 已完成当前歌曲、队列导航、文件物化、服务调用、会话恢复、播放模式和最近播放。
4. ~~建立 Flutter module、Platform Channel 和 EventChannel，以 Drawer + 歌曲列表 + 固定播放器 + 三页播放器面板作为首个正式 UI。~~ 已完成首个可运行闭环和基础歌单创建；下一步实现歌单详情及歌曲管理，再扩展专辑、歌手和搜索页面。

### 当前构建基线（2026-08-05）

- Flutter 3.44.8 stable，采用源码 add-to-app 模块 `mobile/easy_player_ui/`；`android-app/settings.gradle.kts` 通过 Flutter 的 `include_flutter.groovy` 引入 `:flutter`。
- Android 宿主使用 Gradle 9.1、AGP 9.0.1、Kotlin 2.3.20，`compileSdk = 36`、`targetSdk = 35`、`minSdk = 28`；Flutter embedding 要求前者至少为 36，target/min SDK 不因此改变。
- 宿主必须同时提供 Flutter AAR、Google 与 Maven Central 仓库。AGP 9 的旧 DSL 兼容开关暂时保留在 `android-app/gradle.properties`；Flutter module 与 `engine-android` 仍使用 Kotlin Gradle Plugin，构建会给出面向 AGP 10 的迁移警告，但当前 Debug APK 已验证可构建、安装和运行。

## 7. 技术决策与风险记录

- `minSdk` 保持 28：当前原生 FFmpeg 依赖需要该 API 级别；如需降低版本，须先替换或重新构建相关依赖。
- Android 不应承诺桌面级 bit-perfect/ASIO/DoP 行为，实际输出能力由设备、系统混音和 USB 音频路由决定。
- `content://` 授权可能失效，不能把文件系统路径当作永久标识；扫描和播放需支持重新授权与跳过失效项。
- Android 11 及以上版本的 SAF 不允许应用取得 `Download` 根目录的树授权；默认以 MediaStore 扫描系统音频（可覆盖 Download 中已被系统索引的音乐），SAF 批量导入则引导用户选择 `Music` 或 `Download` 下的子目录。
- 网络资源、歌词服务与下载功能在法律、服务条款和接口稳定性确认前不得进入发布版本。
- 新增引擎配置时，应先在 `engine-core` 定义跨平台契约，再分别由 Windows 与 Android 适配层实现，禁止复制两套 DSP 逻辑。

## 8. 关联文档

- [Android 原型与环境状态](android-development-plan.md)
- [引擎架构说明](engine/architecture.md)
- [引擎构建与集成说明](engine/build-and-integration.md)
