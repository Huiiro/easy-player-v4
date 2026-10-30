# 原生依赖与外部工具

本目录保存音频引擎的构建入口、依赖配置和外部工具版本锁。
以下命令均从项目根目录执行。当前已验证的发行目标为 Windows x64；
macOS 有独立构建入口，但尚未完成与 Windows 对等的依赖与功能适配。

## 目录用途

| 路径                 | 用途                                                        | 是否提交 Git |
| -------------------- | ----------------------------------------------------------- | ------------ |
| `CMakeLists.txt`     | 原生音频模块构建入口，连接共享 `engine-core` 与平台输出后端 | 是           |
| `native-deps/`       | 锁定的依赖清单、FFmpeg 音频配置、源码校验和及 CMake 配置    | 是           |
| `ytdlp-release.json` | yt-dlp 版本和各平台官方资产的大小、SHA-256                  | 是           |
| `yt-dlp/`            | 下载到本机的分平台可执行文件及校验清单                      | 否，已忽略   |
| `ffmpeg/`            | 旧的本地完整 FFmpeg SDK；Windows 构建已不再选用             | 否，已忽略   |
| `cmake-build-*/`     | IDE 在本机生成的构建目录，不是依赖源码                      | 不应提交     |

`resources/lib/native-deps` 是可复现构建所需的**配置**；项目根目录下的
`build/native-deps` 才是下载、源码展开、编译与安装的**生成产物**。
后者可以删除后重新生成，但会失去本机构建缓存。

安装包不会复制整个 `resources/lib` 或 SDK，只携带目标平台需要的运行文件。

## Windows 音频依赖

统一入口为 `npm run prepare:native`。配置文件如下：

- `native-deps/vcpkg.json`：锁定 vcpkg 基线，声明 FFmpeg、libsamplerate 和 SoundTouch。
- `native-deps/ffmpeg-profile.cmake`：FFmpeg 8.1.2 音频功能白名单。
- `native-deps/triplets/x64-windows-audio.cmake`：Windows x64 Release 构建参数；zlib 静态链接进 FFmpeg。
- `native-deps/sources.json`：SoundTouch 官方提交及源码归档校验和。
- `native-deps/audio-dependencies.cmake`：供原生模块与测试共用的依赖路径和配置校验。

FFmpeg 保留常用音频与 DSD 解码、HTTPS/HLS 音频、封面、标签重封装、重采样和
分轨需要的 PCM 输出。CLI 需要精简的 avfilter；不构建视频编码、设备采集、
swscale、GPU 或重型视频滤镜依赖。

本机与 Windows CI 使用相同配置，生成目录为：

```text
build/
  native-deps/
    overlay/                          # 从锁定 vcpkg 提交生成的定制 port
    buildtrees/                       # 依赖源码与编译中间产物
    packages/                         # vcpkg 打包中间产物
    installed/x64-windows-audio/       # 头文件、链接库、DLL、CLI 和校验清单
  native-addon/                       # 开发运行与发行打包使用的原生模块、运行库
```

准备环境需要 Node.js（版本见 `.nvmrc`）、Git、CMake、Visual Studio 2022
Desktop C++ 与 Windows SDK。可通过 `VCPKG_ROOT` 指定已有 vcpkg Git 仓库；
未指定时，脚本在 `build/native-deps/vcpkg` 创建锁定版本的仓库。

```powershell
npm ci
npm run prepare:native
npm run build:native
npm run test:audio-core
npm run test:packaging-deps
```

`build:native` 会在依赖缺失或配置变化时自动准备依赖，并使用当前 Electron
的头文件重新配置音频模块。完整 Windows 打包入口为：

```powershell
npm run build:win -- --publish never
node scripts/verify-windows-package.cjs
```

Windows 安装内容：

- `resources/native/`：音频 `.node`、5 个 FFmpeg DLL、`ffmpeg.exe`、libsamplerate、SoundTouch、VC++ 运行库、许可证与校验清单，以及任务栏助手。
- 应用 EXE 同目录：VC++ 运行库，供原生 Node 模块加载；FFmpeg 所在目录也保留配套副本。
- `ffmpeg-runtime.json`、`msvc-runtime.json`：记录运行库的配置或版本、架构与 SHA-256；打包检查会验证依赖闭合。

VC++ DLL 来自 Visual Studio 的 x64 可再分发目录，不从 System32 拷贝。
自定义安装布局可设置 `EASY_PLAYER_VC_REDIST_DIR`。
运行中的开发播放器可能仍持有旧 DLL；构建会保留被占用文件作为备份，重启后加载新模块。

## yt-dlp 版本与下载

默认版本由 `ytdlp-release.json` 决定，当前锁定为 `2026.10.26`。
各平台使用同一发布版本，并校验对应资产的大小、官方 SHA-256 和实际 `--version` 输出。
已有非空文件不再直接复用；只有与锁文件一致的缓存才会保留。

```powershell
# 按锁文件准备当前平台的工具，可复用已验证缓存
npm run prepare:ytdlp

# 查询最新稳定版，更新四个平台资产的锁文件，再准备当前平台工具
npm run update:ytdlp
```

更新后应提交 `ytdlp-release.json`，使本地与各平台 CI 使用相同版本。
`EASY_PLAYER_YTDLP_RELEASE` 可临时选择某个发布标签或 `latest`，但不会更新锁文件；
Windows 正式包的检查仍要求工具与已提交的版本锁一致。

```text
yt-dlp/
  win/yt-dlp.exe
  win/yt-dlp.exe.manifest.json
  mac/yt-dlp
  mac/yt-dlp.manifest.json
  linux/x64/yt-dlp
  linux/x64/yt-dlp.manifest.json
  linux/arm64/yt-dlp
  linux/arm64/yt-dlp.manifest.json
```

Windows 使用 x64 独立 exe，macOS 使用官方 universal 独立程序，Linux 使用
对应 x64/arm64 的 glibc 独立程序。这些程序自带运行时，不要求用户另装 Python。
资产来自 [yt-dlp 官方发布页](https://github.com/yt-dlp/yt-dlp/releases)。

安装包只复制目标平台的工具到 `resources/lib/yt-dlp/yt-dlp[.exe]`，
并将旁边的校验清单统一命名为 `yt-dlp.manifest.json`。
开发环境使用本目录下的对应平台文件；缺少工具时，应用回退到
`EASY_PLAYER_YTDLP_PATH` 或 PATH 上的 `yt-dlp`。

## macOS 与 Linux 的现状

`prepare:native` 和当前 `x64-windows-audio` 配置只支持 Windows x64，不能直接
在 Mac 上运行或复用生成的 DLL。

现有 macOS 构建通过 Homebrew 获取 `ffmpeg`、`libsamplerate`、`sound-touch`。
`npm run build:mac -- --publish never` 会构建 CoreAudio 音频模块，递归复制所依赖
的 dylib 到 `resources/native/deps`，并重写库路径。它目前没有使用上述音频精简
构建配置，FFmpeg CLI 和可选分轨组件也尚未封装。

后续 Mac 适配应优先处理：

| 依赖                                    | 适配要求                                                              |
| --------------------------------------- | --------------------------------------------------------------------- |
| 音频模块与 `engine-core`                | 在 Mac 重新编译，明确 arm64/x64、Electron 版本和最低 macOS 版本       |
| FFmpeg、libsamplerate、SoundTouch、zlib | 新增 Mac 构建参数，沿用锁定版本与音频功能范围，产出对应架构的库与 CLI |
| better-sqlite3                          | 在目标平台安装并匹配 Electron ABI，不复用 Windows `.node`             |
| Sharp / libvips                         | 安装对应 darwin-arm64 或 darwin-x64 预编译依赖                        |
| yt-dlp                                  | 复用锁文件里的官方 Mac universal 资产，无需自行编译                   |
| 可选 Python 分轨组件                    | 另行制作可重定位的 Mac 运行时和对应架构的依赖；模型权重可复用         |

新增本地依赖目录后还需调整 dylib 封装脚本：目前它只识别 Homebrew 的绝对前缀。
发行前应检查库架构、`@loader_path`/`@rpath`、签名，以及脱离 Homebrew 的运行情况。
VC++ DLL 和 Windows 任务栏助手不进入 Mac 包。

Linux 当前有 Electron/UI 和 yt-dlp 打包入口，但没有完整的原生音频后端与运行库封装；
能生成 AppImage/DEB 不等同于完成播放器适配。

## 可选分轨组件与用户数据

分轨专用 Python、PyTorch、torchaudio、Demucs 和离线模型通过
`npm run package:auto-mix` 单独打包，目前仅支持 Windows x64，不进入基础安装包。
它们与 yt-dlp 自带的 Python 运行时是两套独立组件。

用户下载组件、数据库和缓存不放在 `resources/lib` 或 `build/native-deps`。
组件使用用户数据根目录下的 `player_data/components/auto-mix`，分轨缓存使用
`player_data/auto-mix-stems`，与普通 `player_data/cache` 分离。

更多构建与平台检查见 [发布流程](../../docs/player/release-pipeline.md)
和 [依赖平台审查](../../docs/player/dependency-platform-audit.zh.md)。
