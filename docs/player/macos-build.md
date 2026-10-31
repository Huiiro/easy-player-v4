# Mac 构建与测试

当前优先支持 Apple Silicon（ARM64），最低 macOS 12.0。Windows 不能直接构建
Mac 原生模块；远程验证环境使用 GitHub Actions `macos-15` ARM64 runner。

## 从 Actions 获取测试包

推送分支或手动运行 `macOS build` 后，在成功任务的 Artifacts 下载
`macos-arm64-test`，其中包含 `easy-player-<版本>-mac-arm64.dmg`、ZIP、更新元数据及
独立的 `easy-player-auto-mix-darwin-arm64-1.0.0.zip` / JSON 分轨组件。
普通分支构建不会创建 Release。`v<版本>` 标签会同时构建 Windows x64 与 Mac ARM64，
两端校验成功后统一发布。Mac 产物包含 DMG、ZIP、blockmap 和对应更新通道的
`*-mac.yml`；当前仍使用 ad-hoc 签名，Developer ID/公证和自动更新真机验证尚未完成。

`Release desktop apps` 支持手动选择 `desktop`（默认，Windows + Mac）、`windows`、
`macos` 或 `all`（额外构建 Linux）。手动运行只生成 artifacts，不创建 Release。
`macos-ci.yml` 同时承接分支/PR、手动运行和正式发布的复用调用，统一构建、样式、
音频、分轨组件和依赖校验。日常产物名为 `macos-arm64-test`，发布调用传入
`macos-release`；两者并发组分离，日常构建可以取消旧任务，发布构建不会被其取消。

测试包使用 ad-hoc 签名，尚无 Developer ID/Apple 公证。Gatekeeper 可能阻止首次
打开；核对下载来源后，可通过系统设置的“隐私与安全性”允许该应用打开。

## 本机构建

安装 Xcode Command Line Tools、Git、CMake 和 `.nvmrc` 指定的原生 ARM64 Node.js，
在项目根目录执行：

```sh
uname -m # 应为 arm64，避免 Rosetta 终端
node -p process.arch # 应为 arm64
brew install ninja autoconf automake libtool pkg-config
npm ci
npm run build:mac -- --publish never
npm run test:audio-core
npm run test:macos-package
```

`build:mac` 自动准备 yt-dlp、构建锁定音频依赖/原生模块、检查 TypeScript、打包并
验证 `dist/mac-arm64/EasyPlayer.app`。DMG/ZIP 同样生成在 `dist`。开发运行先执行
`npm run build:native`，再执行 `npm run dev`；开发与打包共用 `build/native-addon`。

SDK 在 `build/native-deps/installed/arm64-osx-audio`；仅此目录需要头文件和链接库。
运行包使用 `Contents/Resources/native` 中的 FFmpeg CLI、音频模块和 `deps/*.dylib`，
无需用户安装 Homebrew、FFmpeg、Node.js 或系统 Python。

## 自动验证范围

- FFmpeg CLI 与原生解码：MP3、AAC、ALAC、FLAC、Vorbis、Opus、AIFF、DSF 和 DFF。
- 标签/封面：M4A、FLAC 的重复编辑、封面保留/替换、压缩音频哈希不变及失败清理。
- C++ 测试：DSP、Remix 节拍分析/交接/异步准备/缓存失效及后端恢复，使用模拟输出设备。
- 包内 Electron 实际加载音频模块、SQLite 查询和 Sharp 图片处理。
- Mach-O 架构、最低系统版本、签名、dylib 依赖闭合、精简库集合与体积门槛。
- 将 SDK 移走后重复包内加载和解码，排除开发目录依赖。
- 独立 Python 组件在中文/空格路径下下载、解压、恢复执行权限、加载本地模型并真实分轨；
  禁止模型联网下载、屏蔽系统 Python/FFmpeg，验证重复请求命中缓存、清缓存和卸载。

## 真机验收与后续适配

2026-10-31 用户实测：DMG 可以打开，播放、封面、编辑和 DSP 正常。
随后用户按手动安装步骤安装 Mac ARM64 Python 分轨组件，确认分轨功能正常。
应用 ZIP 安装、USB DAC、热插拔及最低系统版本继续保留为待验证项目。

原生 Vibrancy 下设置页、下载页的部分组件曾闪烁，页面内拖动组件会留下残影。
已添加 Vibrancy 专用兼容样式，关闭叠加的 CSS backdrop-filter；弹窗保留遮罩，不再
对整个透明应用做额外模糊。2026-10-31 用户用新包真机复测，确认闪烁和拖拽残影已修复。
自动样式回归覆盖设置/下载卡片、弹窗、伪元素、图片滤镜保留和材质切换后的恢复。

在测试 Mac 上安装 DMG，验证启动、导入、播放/暂停、定位、连续切歌、DSP、Remix、
标签编辑和 yt-dlp 下载；特别验证内置扬声器及实际使用的 USB DAC，并测试最低支持
系统。Actions 不接真实输出设备，不能证明听感、设备热插拔或系统权限行为。

当前 CoreAudio 后端使用默认设备共享 PCM，DSD 解码后转 PCM；没有独占/DoP。
常规 BPM、响度和节拍 Remix 使用共享音频核心。人声分轨保护使用下面的可选组件。

## Apple Silicon Python 分轨组件

在播放过渡设置顶部的“人声保护组件”点击下载并安装；支持进度、取消和卸载。
组件与基础 DMG/ZIP 分开发布，基础播放不需要安装。使用 CPython 3.12.16
（Astral python-build-standalone 的 ARM64 可迁移发行版，锁定归档 SHA-256）、
PyTorch/torchaudio 2.5.1、Demucs 4.0.1，以及和 Windows 相同 SHA-256 的 htdemucs 模型。
当前只用 CPU/FP32，未启用 MPS。用户不需要安装 Python、pip 或 Homebrew。

制作组件的构建机需 Python 3.12 或更新版本（Actions runner 已提供）；
使用组件的用户不需要系统 Python。构建机执行 `npm run package:auto-mix`，在 `dist` 生成
`easy-player-auto-mix-darwin-arm64-1.0.0.zip` 和
`easy-player-auto-mix-darwin-arm64.json`；JSON 记录大小、SHA-256 与解压预算。
Mac CI 和标签发布都会构建、验证并上传这两个文件。官方附件发布前，应用内下载会
提示不可用；可先用 Actions 产物进行开发验证。

```sh
npm run package:auto-mix
npm run test:bundled-auto-mix
npm run test:auto-mix-runtime
npm run test:auto-mix-component-install
```

最后一条测试会从本地 ZIP 经过真实安装器安装到隔离测试目录，执行离线分轨，
再测试缓存清理和卸载，不操作真实用户数据。生产与开发默认共用：

- 组件：`~/Library/Application Support/easy_player/player_data/components/auto-mix/versions/<版本和哈希>/`
- 激活指针：组件根目录的 `installed.json`。
- WAV 缓存：`~/Library/Application Support/easy_player/player_data/auto-mix-stems/`，与普通 cache 分离。

手动开发测试可把 ZIP 解压到自选目录，在同一终端设置后启动开发应用：

```sh
export EASY_PLAYER_STEM_PYTHON="/绝对路径/auto-mix/python/bin/python3"
export EASY_PLAYER_STEM_MODEL_REPO="/绝对路径/auto-mix/models"
npm run dev
```

先执行 `npm run build:native` 准备 `build/native-addon/ffmpeg`。以上覆盖仅用于开发，
不写入组件安装指针，设置页仍按正常安装记录显示状态。完整安装测试使用上面的
`test:auto-mix-component-install`。卸载保留生成的 WAV；分轨缓存清理保留组件和模型。

构建移除 pip、SciPy、测试、头文件、静态库和字节码，保留运行所需的动态库、元数据
与许可证；符号链接在打包前实体化。每个 Mach-O 检查 ARM64、最低系统和外部库引用，
使用 ad-hoc 签名。源码见 `scripts/prepare-auto-mix-macos.py`。
Python 来源：[Astral 独立发行版](https://github.com/astral-sh/python-build-standalone)。

2026-10-31 已通过 [GitHub Actions ARM64 验证](https://github.com/Huiiro/easy-player-v4/actions/runs/41198019383)：
独立组件 ZIP 为 187,816,404 字节（179.1 MiB），解压 486,534,473 字节（464.0 MiB）。
源码运行时和经过真实 ZIP 安装器搬移后的运行时，均通过离线分轨与重复请求缓存检查，
并通过清缓存、卸载、3 个分轨决策测试及 worker 取消/超时/重启测试；8 个 C++ 回归同样通过。
两条 3 秒合成音频、关闭人声入口扫描的固定样例中，worker 报告首次请求 31.15–34.44 秒，
同一 worker 内缓存重复请求 0.03–0.04 秒；不包含重复启动开销，不能代表真实歌曲或
40 秒人声入口扫描的性能。2026-10-31 用户已在 Mac 真机手动安装组件并确认分轨
功能正常；最低系统兼容性仍待专项验收。
测试产物：[macos-release](https://github.com/Huiiro/easy-player-v4/actions/runs/41198019383/artifacts/13042130375)。

Intel triplet 已预留但尚未验证。`--universal` 会明确报错；需要先分别验证 arm64/x64
音频模块、FFmpeg、SQLite、Sharp 等原生产物，再建立合并、签名和双架构运行检查。
正式公开发行还需要 Developer ID 签名、公证、安装与自动更新验收。
