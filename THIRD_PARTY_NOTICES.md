# EasyPlayer 第三方声明

EasyPlayer 的原创代码和文档采用 [MIT 许可证](LICENSE)。第三方组件与素材适用各自的许可和使用条款。

## 桌面依赖

- Electron、Chromium 和 Node.js 的声明见发行包中的 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`。
- npm 依赖的版本见 [`package-lock.json`](package-lock.json)，许可和版权文本见发行包中的 `licenses/NPM-LICENSES.txt` 和 `licenses/NPM-UPSTREAM-LICENSES.txt`。
- GSAP（Copyright 2008–2026, GreenSock）适用 [Standard “No Charge” GSAP License](https://gsap.com/standard-license/)。Liquid Glass Studio（Copyright 2024 Charles Yin）采用 [MIT](resources/licenses/liquid-glass-studio.txt)。

## 原生库与外部工具

- FFmpeg 8.1.2 在 Windows 和 macOS 上按 LGPL-2.1-or-later 构建并动态链接。对应[源码](https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz)、[vcpkg 补丁](https://github.com/microsoft/vcpkg/tree/8e8dfb4ba483886936ded5ca201b500b8d8b0096/ports/ffmpeg)和[构建脚本](https://github.com/Huiiro/easy-player-v4/blob/master/scripts/prepare/prepare-native-deps.mjs)可供查阅。
- [SoundTouch 2.4.0 源码](https://github.com/Huiiro/easy-player-v4/blob/master/resources/lib/native-deps/archives/soundtouch-d994965fbbcf0f6ceeed0e72516968130c2912f0.tar.gz)采用 LGPL-2.1-or-later，[libsamplerate 0.2.2](https://github.com/libsndfile/libsamplerate/tree/0.2.2) 采用 BSD-2-Clause，[zlib 1.3.2](https://github.com/madler/zlib/tree/v1.3.2) 采用 Zlib 许可。许可证随包附在 `licenses/`。
- yt-dlp 源码采用 Unlicense，随附的独立可执行文件采用 GPL-3.0-or-later。[对应版本源码和发行文件](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26) · [第三方许可证](resources/licenses/yt-dlp-THIRD_PARTY_LICENSES.txt)
- [Chromaprint / fpcalc 1.6.2](https://github.com/acoustid/chromaprint/releases/tag/v1.6.2) 使用 MIT 和 LGPL-2.1 代码。许可与源码说明随包附在 `lib/fpcalc/`。
- Windows 可再分发的 Visual C++ 运行库适用 [Microsoft 软件许可条款](https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files)。

## 可选组件与示例素材

- Auto Mix 包含 CPython、PyTorch、TorchAudio、Demucs 和 htdemucs 模型。许可随组件附带。[模型来源与构建脚本](https://github.com/Huiiro/easy-player-v4/blob/master/scripts/prepare/prepare-auto-mix-macos.py)
- 示例主题的 ZCOOL KuaiLe 字体采用 [SIL OFL 1.1](docs/themes/nyan-cat/fonts/OFL.txt)。Columbina 插画沿用[原有署名](docs/themes/gi-columbina/licenses/IMAGE-ATTRIBUTION.txt)。
