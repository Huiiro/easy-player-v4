# 依赖打包与平台适配审查

发布流程更新（2026-10-31）：版本标签已接入 Windows x64 + Mac ARM64 联合构建，
两端校验成功后统一发布。Mac 日常 CI 与发布复用同一构建校验流程，产物包含
DMG/ZIP、blockmap 和更新通道元数据；当前仍为 ad-hoc 签名。Linux 仍仅限手动
构建，不纳入标签发布。下文的平台发布表保留为初次审查记录。

Mac 后续适配（2026-10-31）：Apple Silicon 已改用锁定源码、音频白名单和
`arm64-osx-audio` 构建，随包携带 FFmpeg CLI 与 7 个 dylib；已在 GitHub Actions
通过编译、打包、9 种格式解码、标签封面以及包内 SQLite/Sharp 加载，隐藏 SDK 后
仍可运行。输出界面已改为 CoreAudio。最低系统与依赖闭合检查、DSP/Remix 回归
见当前 [Mac 构建说明](macos-build.md)。下文保留初次审查时的状态；Mac 可选分轨、
独占/DoP 和发行签名/公证仍未完成。

后续修复（2026-10-30）：已补齐按 PE 依赖递归收集的 VC++ DLL，同时部署到应用
EXE 与 native 目录，并增加架构/哈希/依赖闭合验证。yt-dlp 已更新至 2026.10.26，
使用四平台资产的官方 SHA-256 锁文件，旧缓存不再仅凭非空复用；本地 macOS/Linux
命令和普通 Linux CI 也已加入准备步骤。下文的对应问题保留为初次审查记录。

审查日期：2026-10-30。代码版本：3.3.1 工作区。Windows 实物依据为
`build/audio-core-package-check` 中 135.57 MiB 的 x64 安装包。
macOS/Linux 为源码与工作流审查，本次没有在对应系统编译、安装或播放验证。

## 结论

Windows x64 的播放、DSP、Remix、可选分轨和打包测试链路最完整，但还发现一个
发布前需要处理的 VC++ 运行库缺口。macOS 有原生 CoreAudio 共享输出，实现与
Windows 不对等；Linux 尚未形成可工作的原生播放链路。之前统一的音频专用
FFmpeg 构建明确只覆盖 Windows，不能理解为三平台依赖已经统一。

## 实际如何打包

| 依赖                                                                                                  | 作用与打包方式                                                                                                         | 平台差异                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Electron 39.8.10                                                                                      | Chromium、Node.js 和应用外壳由 electron-builder 放到安装目录，应用主进程、预加载和 Vue 产物在 `resources/app.asar/out` | 每个 OS/CPU 都需要对应 Electron 包；运行应用不要求用户安装 Node.js                                                                        |
| Vue、Pinia、Router、i18n、GSAP、Headless UI 等                                                        | 渲染端运行代码经 Vite 合并到 `out/renderer`；Tailwind/Vite/TypeScript 是构建工具                                       | 这些依赖可列在 devDependencies，因为运行所需部分已被编译进页面资源                                                                        |
| adm-zip、basic-ftp、@xmldom/xmldom、music-metadata、node-id3、opencc-js、pinyin-pro、electron-updater | 主进程运行包及其传递依赖保留在 `app.asar/node_modules`；实际主包仍有这些外部 require                                   | 主要是 JavaScript，但具体网络和自动更新行为受系统影响                                                                                     |
| better-sqlite3 12.11.1                                                                                | JS 包保留，`better_sqlite3.node` 等放在 `app.asar.unpacked/node_modules/better-sqlite3`                                | 原生模块依赖 Electron ABI/目标架构；`npm ci` 后的 postinstall 负责 `electron-builder install-app-deps`                                    |
| sharp 0.35.3 / libvips                                                                                | 当前 Windows 包只有 `@img/sharp-win32-x64`，其 `.node` 和 DLL 由 builder 解包到文件系统                                | npm 根据 OS/CPU/libc 安装 optionalDependencies；macOS/Linux 要有自己的包，不能复用 Windows node_modules                                   |
| kuroshiro / kuromoji                                                                                  | JS 包与日语词典保留；词典显式解到 `app.asar.unpacked/node_modules/kuromoji/dict`，运行路径会对应转换                   | 词典本身通用；本次验证了包内日语分词，不需要用户额外下载                                                                                  |
| ssh2 / cpu-features                                                                                   | ssh2 保持外部包，支持 SFTP；其原生加速绑定为可选项                                                                     | 当前 Windows 包没有 sshcrypto/cpufeatures 的 `.node`，加载 ssh2 Client 成功，使用 JS/Node crypto 路径；不能把可选加速安装成功作为必需条件 |
| easy_player_native.node                                                                               | N-API 音频入口，共享 `engine-core`，正式包通过绝对路径加载 `resources/native/easy_player_native.node`                  | Windows 与 macOS 各自编译；Linux 没有对应后端、构建步骤和资源规则                                                                         |
| FFmpeg、libsamplerate、SoundTouch                                                                     | Windows 将 5 个 FFmpeg DLL、CLI、samplerate.dll、SoundTouch.dll 放在 `resources/native`；编译和复制使用同一锁定目录    | macOS 从 Homebrew 链接，并递归复制所依赖 dylib 到 `resources/native/deps`，重写为 `@loader_path`；Linux 未封装                            |
| yt-dlp                                                                                                | 按平台下载独立可执行文件，放在 `resources/lib/yt-dlp/`；非 Windows 设置执行权限                                        | Windows x64 exe、macOS universal standalone、Linux x64/arm64 glibc standalone；找不到包内文件时会回退到环境变量/系统命令                  |
| Python / PyTorch / torchaudio / Demucs / 模型                                                         | 分轨专用组件独立 ZIP，当前约 193.8 MiB 下载、480.3 MiB 安装；不进入基础安装包                                          | 当前只有 Windows x64：Python 3.12.10 embed、CPU Torch/torchaudio 2.5.1、Demucs 4.0.1、htdemucs 离线模型                                   |
| Windows 任务栏助手                                                                                    | `easy_player_taskbar.exe` 放在 `resources/native`                                                                      | 仅 Windows；其他平台不构建该程序                                                                                                          |
| 官方插件/插件 SDK                                                                                     | `plugins`、`packages` 源码与依赖被基础包排除；插件另行安装到用户插件目录                                               | 不与播放器 node_modules 混装；包含原生二进制的插件仍需要自行处理平台/架构                                                                 |

Windows 主包还显式排除了源码、测试、构建缓存、vcpkg、脚本、模型组件目录。
因此 `resources/lib/native-deps` 的源码配置和 SDK 头文件不会进入安装包。

## 平台功能与构建差异

| 项目                       | Windows                                                                  | macOS                                                                                | Linux                                                                                        |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 当前目标架构               | 固定 x64；ARM64 不在当前音频/分轨构建支持范围                            | 构建跟随本机架构；当前 macos-14 runner 对应 arm64，未配置双架构矩阵或 universal 应用 | 现有 ubuntu runner 构建 x64 外壳；yt-dlp 脚本虽有 arm64 下载映射，不代表播放器支持完整 arm64 |
| 原生输出                   | DirectSound、WASAPI Shared/Exclusive、ASIO                               | CoreAudio AudioQueue，共享浮点 PCM，仅枚举系统默认设备                               | 缺少 ALSA/PulseAudio/PipeWire 等后端与原生模块                                               |
| 输出界面                   | 后端与设备列表匹配 Windows 能力                                          | 内部沿用 `directsound` 枚举，界面会显示 DirectSound；实际使用 CoreAudio              | 没有能替代原生引擎的 HTMLAudio 播放回退                                                      |
| DSD                        | 解码转 PCM 已验证；DoP 代码路径存在，实际输出仍取决于 DAC/后端           | 共享解码核心可转 PCM；后端标记不支持 DSD/独占，没有 DoP 输出实现                     | 未形成原生解码/输出链路                                                                      |
| BPM、响度、DSP、节拍 Remix | 共享核心；本次此前已有实测与原生回归                                     | 使用同一 engine-core，结构上复用；本次未在 macOS 验证                                | 当前 UI 不能替代缺失的原生计算/播放引擎                                                      |
| 人声分轨保护               | 可选组件可安装，离线推理与缓存已验证                                     | 下载状态不支持；没有对应 Python 组件，包内也未复制 FFmpeg CLI                        | 下载状态不支持，原生引擎与 CLI 均缺                                                          |
| FFmpeg 来源                | vcpkg 基线、8.1.2 源码和音频白名单锁定，含 SHA-256 清单、15 MiB 体积门槛 | `brew install ffmpeg`，版本和功能集未锁定，仍可能引入视频/第三方传递依赖             | 未提供正式运行时                                                                             |
| 格式                       | NSIS exe                                                                 | DMG + ZIP（builder 默认目标）                                                        | AppImage / DEB                                                                               |
| 平台检查                   | 包内容、原生加载、9 种音频/DSD、标签、分轨生命周期等                     | CI 只有编译/打包，没有等价的运行时/播放/包内依赖回归                                 | CI 仅编译页面及打包，没有原生音频可用性检查                                                  |
| 文件关联                   | NSIS 脚本注册音频扩展名                                                  | 未见对应的文档类型/文件关联声明                                                      | 未见对应 MIME/音频关联声明                                                                   |
| 发布                       | 标签流程当前只发布 Windows x64                                           | 手动选择 all 才构建为 artifact，不随当前标签发布                                     | 同 macOS；构建 artifact 不表示功能适配完成                                                   |

`macos-14` 当前架构依据 [GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。
打包脚本本身没有显式固定 macOS 架构，因此仍应在构建产物中记录并校验架构。

## 发现的问题及优先级

### P1：Windows VC++ 运行库没有闭合

通过 dumpbin 读取本次安装包里的 DLL 导入表，结果是：

- FFmpeg 和 libsamplerate 引用 `VCRUNTIME140.dll`。
- SoundTouch 还引用 `MSVCP140.dll` 和 `VCRUNTIME140_1.dll`。
- 本次安装目录中没有这些 VC++ DLL，NSIS 配置也没有安装 VC++ Redistributable 的步骤。

开发机和测试机可能已经装有运行库，所以当前本机加载测试不能证明干净 Windows
机器完全自包含。没有相应运行库的机器存在音频模块加载失败的风险。
这是根据导入表得出的依赖缺口，并非已经在无运行库虚拟机中复现。

处理方向是明确选择运行库部署方式：随安装器部署 VC++ Redistributable、应用本地
携带所需运行库，或调整可静态链接的原生组件。之后应在干净机器验证。
参考 [Microsoft 原生依赖部署说明](https://learn.microsoft.com/en-us/cpp/windows/deployment-in-visual-cpp?view=msvc-170)。

### P1：Linux 包缺少核心音频功能

`build:linux` 不调用原生构建，Linux extraResources 只有 yt-dlp；CMake 没有 Linux
后端分支，非 Apple 路径使用的是 Windows 适配器。renderer 的 audioBridge 始终
通过 IPC 调用原生管理器，没有 HTMLAudio 回退。因此当前 Linux 包可能能启动界面，
但不能作为具备正常播放、DSP、Remix 功能的版本发布。

### P2：macOS 依赖与音频能力未达到 Windows 对等

- Homebrew 版本未固定，没有使用 Windows 的音频功能白名单。
- dylib 封装只自动处理 `/opt/homebrew`、`/usr/local` 的现存绝对路径；没有最终
  验证所有依赖均已闭合，其他绝对前缀和未解析的 `@rpath` 需要单独检查。
- 只有系统默认共享输出，DirectSound 的内部兼容枚举泄漏到了界面标签。
- 人声分轨组件校验路径仍硬编码 `python/python.exe`，当前不是跨平台组件协议。
- 未配置 Developer ID/公证的完整发行链路；脚本对 native dylib 的 ad-hoc 签名
  只用于使修改后的库可加载，不能等同于发行签名和自动更新验证。
- Windows 有实物包与运行时回归，macOS 目前没有相同门槛。

macOS 自动更新要求应用签名，且需要对应 ZIP 更新产物，参考
[electron-builder v26 自动更新文档](https://www.electron.build/v26/docs/features/auto-update/)。

### P2：yt-dlp 版本和准备步骤不完全一致

- 当前 Windows 包实际执行 `--version` 得到 `2026.03.17`，文件约 17.59 MiB。
- 默认下载 latest；已有非空文件就直接复用，不检查它是否是指定版本，也不核对
  发布资产的 SHA-256。不同本地缓存、不同平台或不同日期的 CI 会得到不同版本。
- `build:mac`、`build:linux` 本地命令不自动执行 prepare:ytdlp。macOS CI 与手动
  release/all 的 Linux 流程有准备步骤，但普通 Linux CI 缺少该步骤。
- 当前 Linux 下载映射为 glibc 版，并未覆盖 musl 发行版的独立二进制。

建议将资产版本、每个平台的校验和与可执行性检查统一进准备入口，然后增加包内
`yt-dlp --version` 测试。上游已经提供 SHA256/SHA512 清单。

注意：yt-dlp standalone 本身自带 Python。当前 Windows exe 内可识别到
`python310.dll`，与可选分轨组件的 Python 3.12.10 是两套独立运行时。
因此“分轨 Python 不随基础包携带”成立，但不能理解为基础包里完全没有 Python。
参见 [yt-dlp 官方发布文件说明](https://github.com/yt-dlp/yt-dlp#release-files)。

### P2：原生 Node 模块依赖安装顺序与目标架构

`postinstall=electron-builder install-app-deps` 是当前 SQLite ABI 修正入口。
同时配置 `npmRebuild:false`，意味着打包阶段不会再修复错误的 node_modules。
每个 OS/架构应原生执行 npm ci、保留 optionalDependencies，再构建/测试；复制
另一平台的 node_modules 或跳过安装脚本可能留下错误二进制。
Sharp 当前包内只保留 Windows x64 原生实现，未发现混入其他平台实现。

参考 [Electron 原生模块说明](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
与 [Sharp 安装说明](https://sharp.pixelplumbing.com/install/)。

## 用户数据与组件位置

开发/正式环境在同一操作系统使用相同的 `easy_player` 数据根目录；可用
`EASY_PLAYER_DATA_DIR` 指定隔离位置。目录分离策略跨平台一致：

| 平台    | 默认根目录                                                         |
| ------- | ------------------------------------------------------------------ |
| Windows | `%APPDATA%/easy_player`                                            |
| macOS   | `~/Library/Application Support/easy_player`                        |
| Linux   | `$XDG_CONFIG_HOME/easy_player`，未设置时为 `~/.config/easy_player` |

- 数据库：`player_data/player.db`。
- 普通缓存：`player_data/cache`。
- 分轨缓存：`player_data/auto-mix-stems`。
- 可选组件：`player_data/components/auto-mix/versions/<active>`。
- 用户插件：`player_plugin`。

路径使用 path.join；跨平台共享的是目录规则，并不意味着同一份 DLL/Python
组件能在不同 OS 或 CPU 上通用。

## 本次验证范围

直接在 Windows 安装包的 Electron 中再次验证了 SQLite 内存查询、Sharp 图像
编码/读取、ssh2 Client 加载、Kuromoji 词典分词，均通过。实际 app.asar 中只有
Sharp 和 better-sqlite3 两类 `.node`；音频模块位于独立 native 目录。

主要运行依赖体积（逻辑文件合计，非安装器压缩后的贡献，不能相加推导 exe 大小）：

| 项目                 |       大小 |
| -------------------- | ---------: |
| FFmpeg CLI + 5 DLL   |   4.75 MiB |
| 整个 native 目录     | 约 7.5 MiB |
| yt-dlp Windows exe   |  17.59 MiB |
| @img/sharp-win32-x64 |  18.30 MiB |
| kuromoji（含词典）   |  17.37 MiB |
| opencc-js            |   5.79 MiB |
| better-sqlite3       |   1.86 MiB |

完整实物清单位于本地 `build/audio-core-package-check/dependency-inventory.json`。
本次为依赖与平台审查，未执行远程 CI、macOS/Linux 安装测试或发布操作。
