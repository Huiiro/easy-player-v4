# Mac 构建与测试

当前优先支持 Apple Silicon（ARM64），最低 macOS 12.0。Windows 不能直接构建
Mac 原生模块；远程验证环境使用 GitHub Actions `macos-15` ARM64 runner。

## 从 Actions 获取测试包

推送分支或手动运行 `macOS build` 后，在成功任务的 Artifacts 下载
`macos-arm64-test`，其中包含 `easy-player-<版本>-mac-arm64.dmg`、ZIP 及更新元数据。
普通分支构建不会创建 Release；当前版本标签仍只自动发布 Windows x64。

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

## 真机验收与后续适配

在测试 Mac 上安装 DMG，验证启动、导入、播放/暂停、定位、连续切歌、DSP、Remix、
标签编辑和 yt-dlp 下载；特别验证内置扬声器及实际使用的 USB DAC，并测试最低支持
系统。Actions 不接真实输出设备，不能证明听感、设备热插拔或系统权限行为。

当前 CoreAudio 后端使用默认设备共享 PCM，DSD 解码后转 PCM；没有独占/DoP。
常规 BPM、响度和节拍 Remix 使用共享音频核心。人声分轨保护依赖可选 Python 组件，
Mac 组件尚未制作，不能复用 Windows Python/PyTorch。用户数据仍按 Mac 的用户数据
根目录存放，分轨缓存与普通 cache 分离。

Intel triplet 已预留但尚未验证。`--universal` 会明确报错；需要先分别验证 arm64/x64
音频模块、FFmpeg、SQLite、Sharp 等原生产物，再建立合并、签名和双架构运行检查。
正式公开发行还需要 Developer ID 签名、公证、安装与自动更新验收。
