# scripts 整理前审计记录

> 本文记录目录整理前的检查结果；当前目录与运行入口见 [scripts/README.md](../scripts/README.md)。三个旧路径测试和背景释放 mock 已在后续整理中修复，一次性生成器已归档至 examples/，预览工具已移至 dev/。新增 test:script-layout、背景清理、窗口、歌词与频谱测试入口，并修复了目录迁移后的构建/CI/打包/文档引用。下文的引用数量、失败记录及建议属于整理前快照。

审计日期：2026-11-14。基于提交 `573420f` 的 Git 跟踪文件、package.json、CI、构建配置、文档和脚本间引用。

## 分类结论

共 180 个跟踪文件，包含脚本、CMake/C++ 测试和夹具，并非 180 个可执行入口。

| 分类                               | 文件数 | 建议                                   |
| ---------------------------------- | -----: | -------------------------------------- |
| 构建、发布、开发维护工具及其辅助库 |     34 | 保留；有些由其他脚本或打包钩子间接调用 |
| 功能/UI/集成回归测试               |    133 | 保留；其中 3 个确认旧路径失效，应修复  |
| 性能与原生频谱基准                 |      6 | 保留，按需运行                         |
| 测试辅助库与测试夹具               |      4 | 随对应测试保留，不能因非独立入口删除   |
| 固定主题样例生成器                 |      2 | 一次性候选，可归档；仍有重建样例价值   |
| 手工歌词预览工具                   |      1 | 按需保留或移到开发工具目录             |

114 个文件被 package.json 命令直接引用；27 个文件没有发现其他跟踪文本文件对其文件名的静态引用。后者不代表无用，可能是手工入口或通过目录/动态路径调用。引用统计在生成本报告前完成，未计入本报告自身。

## 优先处理的问题

1. **修复三个测试的源码路径。** `check-background-disposal.mjs` 和 `check-solid-background-transition.mjs` 引用旧的 `components/background/SolidBackground.vue`；`check-liquid-motion.mjs` 引用旧的 `components/background/liquidMotion.ts`。现有文件位于 `components/background/player/`。三者已实际运行并报 ENOENT。应先修路径并验证行为，再决定是否合并，不建议删除回归覆盖。
2. **补齐有价值测试的统一入口。** 推荐、统计、歌词对比度、频谱配色及窗口显示等测试没有统一 npm/CI 入口。名称接近不等于重复：例如 `test-window-material.mjs` 测试状态、迁移与回滚，`check-window-material.cjs` 调用真实 Electron 窗口，现有 `test:window-material` 实际指向 `check-mica-dialog.cjs`。
3. **将样例生成器与长期工程工具分开。** 两个 `create-*.mjs` 写入固定 docs 目录并生成固定主题 ZIP；属于样例再生成工具，不属于构建发布链路。`lyrics-v2-preview.mjs` 启动固定端口 5197 的交互预览服务，没有自动通过/失败判定，也不属于测试集。
4. **保留外部插件仓库桥接。** 14 个文件直接导入 `lib/plugin-require.mjs`，默认依赖相邻的 `easy-player-plugin`，可通过 `EASY_PLAYER_PLUGIN_DIR` 指定。仅检出主仓库可能无法运行；这是环境前提，不能据此认定脚本过期。部分主题测试也通过这些工具间接依赖插件仓库。
5. **测试覆盖不能从 CI 通过推断。** CI/Release 主要接入音频核心、运行库、安装包、Auto Mix 及 macOS 部分 UI 验证；大量 npm 测试命令未被默认 CI 调用。

## 定向运行结果

本次只运行 8 个不启动完整应用的 Node 回归入口，没有执行全部 133 个测试，也没有运行生成器或迁移命令。

| 结果                    | 文件                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| 失败：旧源码路径 ENOENT | [check-background-disposal.mjs](../scripts/tests/appearance/check-background-disposal.mjs)                 |
| 失败：旧源码路径 ENOENT | [check-liquid-motion.mjs](../scripts/tests/appearance/check-liquid-motion.mjs)                             |
| 通过                    | [check-lyrics-contrast.mjs](../scripts/tests/lyrics/check-lyrics-contrast.mjs)                         |
| 失败：旧源码路径 ENOENT | [check-solid-background-transition.mjs](../scripts/tests/appearance/check-solid-background-transition.mjs) |
| 通过                    | [check-song-theme.mjs](../scripts/tests/appearance/check-song-theme.mjs)                                   |
| 通过                    | [test-spectrum-color.mjs](../scripts/tests/audio/test-spectrum-color.mjs)                             |
| 通过                    | [test-window-material.mjs](../scripts/tests/system/test-window-material.mjs)                           |
| 通过                    | [test-window-presentation.mjs](../scripts/tests/system/test-window-presentation.mjs)                   |

## 一次性候选与预览工具

| 文件                                                      | 依据                                                                                 | 建议                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [create-theme-demo.mjs](../scripts/examples/create-theme-demo.mjs) | 固定读取 docs/themes/neon-test.theme.json，生成 resource-demo 目录及 ZIP；无静态引用 | 可归档，保留重建示例的说明                             |
| [create-nyan-theme.mjs](../scripts/examples/create-nyan-theme.mjs) | 固定生成 Nyan Cat 图片、主题清单与 ZIP，依赖既有字体文件；无静态引用                 | 可归档，保留字体许可及现有样例；测试仍使用这些样例资源 |
| [lyrics-v2-preview.mjs](../scripts/dev/lyrics-v2-preview.mjs) | 文档引用的 Vite 手工预览；模拟歌词数据，监听 127.0.0.1:5197                          | 开发工具，按需保留，不加入自动测试                     |

`migrate-legacy-library.mjs` 虽然用户通常只执行一次，但它是正式迁移入口且有测试，不属于可删除的一次性开发脚本。`setup-auto-mix-stems.ps1` 虽名为 setup，也仍被运行时准备流程调用。

## 完整分类清单

以下调用情况来自静态引用检查，不保证所有动态调用都能识别。测试文件默认具有长期回归价值，不表示已经逐项验证通过。

### 构建、发布和维护工具（34）

| 文件                                                                      | 用途/状态                             | 调用情况                                           |
| ------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| [build-macos.mjs](../scripts/build/build-macos.mjs)                             | macOS 构建、打包与包校验入口          | npm: `build:mac`                                   |
| [build-native.mjs](../scripts/build/build-native.mjs)                           | 跨平台原生音频模块构建入口            | npm: `build:native`、`build:native:debug`          |
| [build-taskbar-controls.mjs](../scripts/build/build-taskbar-controls.mjs)       | Windows 任务栏程序构建                | npm: `build:taskbar`                               |
| [bundle-macos-native-deps.js](../scripts/build/bundle-macos-native-deps.js)     | macOS 原生动态库归集                  | 被 1 个脚本引用                                    |
| [copy-native-assets.js](../scripts/build/copy-native-assets.js)                 | 原生模块与 DLL 归集                   | 被 1 个脚本引用；原生 CMake 调用                   |
| [file-associations.nsh](../scripts/package/file-associations.nsh)                 | NSIS 文件关联安装逻辑                 | 被 1 个脚本引用；打包配置钩子/资源                 |
| [lib/migrate-legacy-library.ts](../scripts/lib/migrate-legacy-library.ts) | 旧曲库迁移实现                        | 被 1 个脚本引用                                    |
| [lib/plugin-require.mjs](../scripts/lib/plugin-require.mjs)               | 独立插件仓库定位与依赖解析            | 被 14 个脚本引用                                   |
| [lib/ytdlp.mjs](../scripts/lib/ytdlp.mjs)                                 | yt-dlp 下载、校验与平台映射           | 被 3 个脚本引用                                    |
| [macos-runtime.cjs](../scripts/lib/macos-runtime.cjs)                         | macOS 运行依赖及架构校验              | 被 4 个脚本引用                                    |
| [migrate-legacy-library.mjs](../scripts/maintenance/migrate-legacy-library.mjs)       | 旧曲库迁移命令；按需维护工具          | npm: `migrate:legacy`；被 1 个脚本引用             |
| [native-platform.cjs](../scripts/lib/native-platform.cjs)                     | 原生目标平台映射                      | 被 5 个脚本引用                                    |
| [native-runtime-paths.cjs](../scripts/lib/native-runtime-paths.cjs)           | 原生依赖路径及构建配置哈希            | CI 直接引用；被 9 个脚本引用；文档有运行说明       |
| [pack-theme.mjs](../scripts/plugins/pack-theme.mjs)                               | 转调插件仓库的主题打包器              | npm: `pack:theme`；被 2 个脚本引用；文档有运行说明 |
| [package-auto-mix-runtime.mjs](../scripts/package/package-auto-mix-runtime.mjs)   | Auto Mix 可选组件分发打包             | npm: `package:auto-mix`                            |
| [package-theme-examples.mjs](../scripts/package/package-theme-examples.mjs)       | 主题示例转换与打包，可重复使用        | npm: `pack:themes`                                 |
| [package-windows.mjs](../scripts/package/package-windows.mjs)                     | Windows 打包入口                      | npm: `build:unpack`、`build:win`；CI 直接引用      |
| [prepare-auto-mix-ffmpeg.mjs](../scripts/prepare/prepare-auto-mix-ffmpeg.mjs)     | 精简 FFmpeg 运行依赖准备              | npm: `prepare:ffmpeg`；被 2 个脚本引用             |
| [prepare-auto-mix-macos.py](../scripts/prepare/prepare-auto-mix-macos.py)         | macOS 人声分离运行时准备              | 被 1 个脚本引用；文档有运行说明                    |
| [prepare-auto-mix-runtime.mjs](../scripts/prepare/prepare-auto-mix-runtime.mjs)   | 人声分离运行时准备入口                | npm: `prepare:auto-mix`                            |
| [prepare-auto-mix-runtime.py](../scripts/prepare/prepare-auto-mix-runtime.py)     | Windows 人声分离运行时准备            | 被 1 个脚本引用                                    |
| [prepare-fpcalc.mjs](../scripts/prepare/prepare-fpcalc.mjs)                       | 音频指纹工具准备与校验                | npm: `prepare:fpcalc`                              |
| [prepare-native-deps.mjs](../scripts/prepare/prepare-native-deps.mjs)             | 原生编解码及音频依赖准备              | npm: `prepare:native`；被 1 个脚本引用             |
| [prepare-windows-runtime.mjs](../scripts/prepare/prepare-windows-runtime.mjs)     | VC++ 运行库归集与清单生成             | 被 1 个脚本引用                                    |
| [prepare-ytdlp.mjs](../scripts/prepare/prepare-ytdlp.mjs)                         | yt-dlp 固定版本准备                   | npm: `prepare:ytdlp`                               |
| [run-plugin-project.mjs](../scripts/plugins/run-plugin-project.mjs)               | 在独立插件仓库中执行 npm 命令         | npm: `build:plugins`、`typecheck:plugins`          |
| [setup-auto-mix-stems.ps1](../scripts/prepare/setup-auto-mix-stems.ps1)           | 运行时准备流程调用的 Windows 安装辅助 | 被 2 个脚本引用                                    |
| [sync-official-plugins.mjs](../scripts/plugins/sync-official-plugins.mjs)         | 官方插件产物同步                      | npm: `build:plugins`                               |
| [sync-theme-contract.mjs](../scripts/plugins/sync-theme-contract.mjs)             | 主题 SDK 契约同步与检查               | npm: `sync:theme-contract`、`test:theme-contract`  |
| [update-ytdlp.mjs](../scripts/maintenance/update-ytdlp.mjs)                           | 更新 yt-dlp 版本锁定信息              | npm: `update:ytdlp`                                |
| [verify-auto-mix-package.cjs](../scripts/package/verify-auto-mix-package.cjs)     | electron-builder 打包前资源检查钩子   | 打包配置钩子/资源                                  |
| [verify-macos-package.cjs](../scripts/package/verify-macos-package.cjs)           | macOS 完整安装包校验                  | npm: `test:macos-package`；被 1 个脚本引用         |
| [verify-windows-package.cjs](../scripts/package/verify-windows-package.cjs)       | Windows 完整安装包校验                | CI 直接引用；文档有运行说明                        |
| [windows-runtime.cjs](../scripts/lib/windows-runtime.cjs)                     | PE 导入分析及 VC++ 依赖完整性检查     | 被 3 个脚本引用                                    |

### 功能、UI 和集成测试（133）

| 文件                                                                                      | 用途/状态                    | 调用情况                                                                                                                |
| ----------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [check-animation-activity.cjs](../scripts/tests/ui/check-animation-activity.cjs)                   | 回归测试；本次未执行         | npm: `test:animation-activity`                                                                                          |
| [check-appearance.cjs](../scripts/tests/appearance/check-appearance.cjs)                                   | 回归测试；本次未执行         | npm: `test:appearance`                                                                                                  |
| [check-automatic-updates.cjs](../scripts/tests/system/check-automatic-updates.cjs)                     | 回归测试；本次未执行         | npm: `test:updates`                                                                                                     |
| [check-background-disposal.mjs](../scripts/tests/appearance/check-background-disposal.mjs)                 | 确认失效：旧源码路径，待修复 | 未发现静态引用                                                                                                          |
| [check-background-transition.cjs](../scripts/tests/appearance/check-background-transition.cjs)             | 回归测试；本次未执行         | npm: `test:background-transition`                                                                                       |
| [check-black-hole.mjs](../scripts/tests/ui/check-black-hole.mjs)                                   | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-card-motion.cjs](../scripts/tests/appearance/check-card-motion.cjs)                                 | 回归测试；本次未执行         | npm: `test:card-motion`                                                                                                 |
| [check-columbina-theme.cjs](../scripts/tests/appearance/check-columbina-theme.cjs)                         | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [check-custom-theme.cjs](../scripts/tests/appearance/check-custom-theme.cjs)                               | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-desktop-lyrics-settings.cjs](../scripts/tests/lyrics/check-desktop-lyrics-settings.cjs)         | 回归测试；本次未执行         | npm: `test:desktop-lyrics-settings`                                                                                     |
| [check-file-associations.cjs](../scripts/tests/system/check-file-associations.cjs)                     | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [check-footer-layout.cjs](../scripts/tests/ui/check-footer-layout.cjs)                             | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-footer-menu.cjs](../scripts/tests/ui/check-footer-menu.cjs)                                 | 回归测试；本次未执行         | npm: `test:footer-menu`                                                                                                 |
| [check-global-search.cjs](../scripts/tests/ui/check-global-search.cjs)                             | 回归测试；本次未执行         | npm: `test:global-search`                                                                                               |
| [check-home-layout.cjs](../scripts/tests/ui/check-home-layout.cjs)                                 | 回归测试；本次未执行         | npm: `test:home`                                                                                                        |
| [check-library-settings.cjs](../scripts/tests/library/check-library-settings.cjs)                       | 回归测试；本次未执行         | npm: `test:library-auto-import:ui`                                                                                      |
| [check-liquid-glass-components.cjs](../scripts/tests/appearance/check-liquid-glass-components.cjs)         | 回归测试；本次未执行         | npm: `test:liquid-glass-components`                                                                                     |
| [check-liquid-glass-regressions.cjs](../scripts/tests/appearance/check-liquid-glass-regressions.cjs)       | 回归测试；本次未执行         | npm: `test:liquid-glass-regressions`                                                                                    |
| [check-liquid-glass-scroll.cjs](../scripts/tests/appearance/check-liquid-glass-scroll.cjs)                 | 回归测试；本次未执行         | npm: `test:liquid-glass-scroll`                                                                                         |
| [check-liquid-glass-search.cjs](../scripts/tests/appearance/check-liquid-glass-search.cjs)                 | 回归测试；本次未执行         | npm: `test:liquid-glass-search`                                                                                         |
| [check-liquid-glass-studio.cjs](../scripts/tests/appearance/check-liquid-glass-studio.cjs)                 | 回归测试；本次未执行         | npm: `test:liquid-glass-studio`                                                                                         |
| [check-liquid-glass.cjs](../scripts/tests/appearance/check-liquid-glass.cjs)                               | 回归测试；本次未执行         | npm: `test:liquid-glass`                                                                                                |
| [check-liquid-motion.mjs](../scripts/tests/appearance/check-liquid-motion.mjs)                             | 确认失效：旧源码路径，待修复 | 未发现静态引用                                                                                                          |
| [check-list-loading.cjs](../scripts/tests/ui/check-list-loading.cjs)                               | 回归测试；本次未执行         | npm: `test:list-loading`                                                                                                |
| [check-lyrics-contrast.mjs](../scripts/tests/lyrics/check-lyrics-contrast.mjs)                         | 未接入统一入口；本次运行通过 | 未发现静态引用                                                                                                          |
| [check-lyrics-editor.cjs](../scripts/tests/lyrics/check-lyrics-editor.cjs)                             | 回归测试；本次未执行         | npm: `test:lyrics-editor`                                                                                               |
| [check-lyrics-manager.cjs](../scripts/tests/lyrics/check-lyrics-manager.cjs)                           | 回归测试；本次未执行         | npm: `test:lyrics-manager`                                                                                              |
| [check-mesh-background.cjs](../scripts/tests/appearance/check-mesh-background.cjs)                         | 回归测试；本次未执行         | npm: `test:mesh-background`                                                                                             |
| [check-mica-dialog.cjs](../scripts/tests/ui/check-mica-dialog.cjs)                                 | 回归测试；本次未执行         | npm: `test:window-material`                                                                                             |
| [check-modal-lifecycle.cjs](../scripts/tests/ui/check-modal-lifecycle.cjs)                         | 回归测试；本次未执行         | npm: `test:modal-lifecycle`                                                                                             |
| [check-network-sources.cjs](../scripts/tests/plugins/check-network-sources.cjs)                         | 回归测试；本次未执行         | npm: `test:source-management:ui`                                                                                        |
| [check-nyan-theme.cjs](../scripts/tests/appearance/check-nyan-theme.cjs)                                   | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-particle-background.cjs](../scripts/tests/appearance/check-particle-background.cjs)                 | 回归测试；本次未执行         | npm: `test:particle-background`                                                                                         |
| [check-playback-view.cjs](../scripts/tests/ui/check-playback-view.cjs)                             | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [check-player-panel-switch.cjs](../scripts/tests/ui/check-player-panel-switch.cjs)                 | 回归测试；本次未执行         | npm: `test:mesh-background`、`test:particle-background`、`test:ambient-background`、`test:track-switch`；文档有运行说明 |
| [check-plugin-proxy-settings.cjs](../scripts/tests/plugins/check-plugin-proxy-settings.cjs)             | 回归测试；本次未执行         | npm: `test:plugin-proxy`                                                                                                |
| [check-range-colors.cjs](../scripts/tests/appearance/check-range-colors.cjs)                               | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-remote-source-ui.cjs](../scripts/tests/plugins/check-remote-source-ui.cjs)                       | 回归测试；本次未执行         | npm: `test:remote-sources:ui`                                                                                           |
| [check-scroll-position.cjs](../scripts/tests/ui/check-scroll-position.cjs)                         | 回归测试；本次未执行         | npm: `test:scroll-position`                                                                                             |
| [check-settings-search.cjs](../scripts/tests/ui/check-settings-search.cjs)                         | 回归测试；本次未执行         | npm: `test:settings-search`                                                                                             |
| [check-solid-background-transition.mjs](../scripts/tests/appearance/check-solid-background-transition.mjs) | 确认失效：旧源码路径，待修复 | 未发现静态引用                                                                                                          |
| [check-song-columns.cjs](../scripts/tests/ui/check-song-columns.cjs)                               | 回归测试；本次未执行         | npm: `test:song-columns`                                                                                                |
| [check-song-theme.mjs](../scripts/tests/appearance/check-song-theme.mjs)                                   | 未接入统一入口；本次运行通过 | 未发现静态引用                                                                                                          |
| [check-source-metadata.cjs](../scripts/tests/plugins/check-source-metadata.cjs)                         | 回归测试；本次未执行         | npm: `test:source-metadata:ui`                                                                                          |
| [check-taskbar-cover.cjs](../scripts/tests/audio/check-taskbar-cover.cjs)                             | 回归测试；本次未执行         | npm: `test:taskbar-cover`                                                                                               |
| [check-taskbar-strip.cjs](../scripts/tests/audio/check-taskbar-strip.cjs)                             | 回归测试；本次未执行         | npm: `test:taskbar`                                                                                                     |
| [check-theme-font-package.cjs](../scripts/tests/appearance/check-theme-font-package.cjs)                   | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-theme-preview.cjs](../scripts/tests/appearance/check-theme-preview.cjs)                             | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [check-theme-system.cjs](../scripts/tests/appearance/check-theme-system.cjs)                               | 回归测试；本次未执行         | npm: `test:theme-system`                                                                                                |
| [check-track-switch.cjs](../scripts/tests/ui/check-track-switch.cjs)                               | 回归测试；本次未执行         | npm: `test:track-switch`；文档有运行说明                                                                                |
| [check-ui-components.cjs](../scripts/tests/ui/check-ui-components.cjs)                             | 回归测试；本次未执行         | npm: `test:ui`                                                                                                          |
| [check-window-material.cjs](../scripts/tests/system/check-window-material.cjs)                         | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-ambient-palette.mjs](../scripts/tests/appearance/test-ambient-palette.mjs)                           | 回归测试；本次未执行         | npm: `test:ambient-background`                                                                                          |
| [test-appearance.mjs](../scripts/tests/appearance/test-appearance.mjs)                                     | 回归测试；本次未执行         | npm: `test:appearance`                                                                                                  |
| [test-application-shutdown.mjs](../scripts/tests/system/test-application-shutdown.mjs)                 | 回归测试；本次未执行         | npm: `test:shutdown`；文档有运行说明                                                                                    |
| [test-audio-ffmpeg.mjs](../scripts/tests/audio/test-audio-ffmpeg.mjs)                                 | 回归测试；本次未执行         | npm: `test:audio-core`；CI 直接引用                                                                                     |
| [test-audio-metadata.mjs](../scripts/tests/audio/test-audio-metadata.mjs)                             | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-auto-mix-component-install.mjs](../scripts/tests/audio/test-auto-mix-component-install.mjs)     | 回归测试；本次未执行         | npm: `test:auto-mix-component-install`                                                                                  |
| [test-auto-mix-runtime.mjs](../scripts/tests/audio/test-auto-mix-runtime.mjs)                         | 回归测试；本次未执行         | npm: `test:auto-mix-runtime`                                                                                            |
| [test-auto-mix-stems.mjs](../scripts/tests/audio/test-auto-mix-stems.mjs)                             | 回归测试；本次未执行         | CI 直接引用；文档有运行说明                                                                                             |
| [test-automatic-updates.mjs](../scripts/tests/system/test-automatic-updates.mjs)                       | 回归测试；本次未执行         | npm: `test:updates`                                                                                                     |
| [test-builtin-plugins.mjs](../scripts/tests/plugins/test-builtin-plugins.mjs)                           | 回归测试；本次未执行         | npm: `test:builtin-plugins`                                                                                             |
| [test-bundled-auto-mix.mjs](../scripts/tests/audio/test-bundled-auto-mix.mjs)                         | 回归测试；本次未执行         | npm: `test:bundled-auto-mix`；被 1 个脚本引用                                                                           |
| [test-changelog.mjs](../scripts/tests/system/test-changelog.mjs)                                       | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-custom-theme.mjs](../scripts/tests/appearance/test-custom-theme.mjs)                                 | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-desktop-lyrics-window.mjs](../scripts/tests/lyrics/test-desktop-lyrics-window.mjs)               | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-download-audio.mjs](../scripts/tests/plugins/test-download-audio.mjs)                             | 回归测试；本次未执行         | npm: `test:download-audio`                                                                                              |
| [test-duplicate-cache.mjs](../scripts/tests/library/test-duplicate-cache.mjs)                           | 回归测试；本次未执行         | npm: `test:duplicate-cache`、`perf:duplicate-fingerprint`                                                               |
| [test-duplicate-checking.mjs](../scripts/tests/library/test-duplicate-checking.mjs)                     | 回归测试；本次未执行         | npm: `test:duplicate-checking`                                                                                          |
| [test-duplicate-files.mjs](../scripts/tests/library/test-duplicate-files.mjs)                           | 回归测试；本次未执行         | npm: `test:duplicate-files`                                                                                             |
| [test-duplicate-task.mjs](../scripts/tests/library/test-duplicate-task.mjs)                             | 回归测试；本次未执行         | npm: `test:duplicate-task`                                                                                              |
| [test-file-drop-import.mjs](../scripts/tests/library/test-file-drop-import.mjs)                         | 回归测试；本次未执行         | npm: `test:file-drop-import`                                                                                            |
| [test-file-transfer.mjs](../scripts/tests/plugins/test-file-transfer.mjs)                               | 回归测试；本次未执行         | npm: `test:remote-sources`                                                                                              |
| [test-fingerprint-diagnostics.mjs](../scripts/tests/library/test-fingerprint-diagnostics.mjs)           | 回归测试；本次未执行         | npm: `test:fingerprint-diagnostics`                                                                                     |
| [test-fingerprint-matching.mjs](../scripts/tests/library/test-fingerprint-matching.mjs)                 | 回归测试；本次未执行         | npm: `test:fingerprint-matching`、`perf:fingerprint-matching`                                                           |
| [test-genres.mjs](../scripts/tests/library/test-genres.mjs)                                             | 回归测试；本次未执行         | npm: `test:genres`                                                                                                      |
| [test-idle-work.mjs](../scripts/tests/system/test-idle-work.mjs)                                       | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-kugou-source.mjs](../scripts/tests/plugins/test-kugou-source.mjs)                                 | 回归测试；本次未执行         | npm: `test:kugou-source`                                                                                                |
| [test-legacy-migration.mjs](../scripts/tests/system/test-legacy-migration.mjs)                         | 回归测试；本次未执行         | npm: `test:legacy-migration`                                                                                            |
| [test-library-auto-import.mjs](../scripts/tests/library/test-library-auto-import.mjs)                   | 回归测试；本次未执行         | npm: `test:library-auto-import`                                                                                         |
| [test-liquid-glass-optics.mjs](../scripts/tests/appearance/test-liquid-glass-optics.mjs)                   | 回归测试；本次未执行         | npm: `test:liquid-glass`                                                                                                |
| [test-listening-stats.mjs](../scripts/tests/library/test-listening-stats.mjs)                           | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-lyric-editor.mjs](../scripts/tests/lyrics/test-lyric-editor.mjs)                                 | 回归测试；本次未执行         | npm: `test:lyrics-editor`                                                                                               |
| [test-lyric-providers.mjs](../scripts/tests/lyrics/test-lyric-providers.mjs)                           | 回归测试；本次未执行         | npm: `test:network-sources`                                                                                             |
| [test-lyrics-motion.mjs](../scripts/tests/lyrics/test-lyrics-motion.mjs)                               | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-macos-runtime.cjs](../scripts/tests/audio/test-macos-runtime.cjs)                               | 回归测试；本次未执行         | npm: `test:macos-runtime`                                                                                               |
| [test-media-image-lifecycle.mjs](../scripts/tests/system/test-media-image-lifecycle.mjs)               | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-native-metadata.mjs](../scripts/tests/audio/test-native-metadata.mjs)                           | 回归测试；本次未执行         | npm: `test:audio-core`、`test:native-metadata`                                                                          |
| [test-native-next-track.cjs](../scripts/tests/audio/test-native-next-track.cjs)                       | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-native-runtime-paths.cjs](../scripts/tests/audio/test-native-runtime-paths.cjs)                 | 回归测试；本次未执行         | CI 直接引用；文档有运行说明                                                                                             |
| [test-network-lyrics.mjs](../scripts/tests/lyrics/test-network-lyrics.mjs)                             | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-network-sources.mjs](../scripts/tests/plugins/test-network-sources.mjs)                           | 回归测试；本次未执行         | npm: `test:network-sources`                                                                                             |
| [test-official-plugins.mjs](../scripts/tests/plugins/test-official-plugins.mjs)                         | 回归测试；本次未执行         | npm: `test:official-plugins`                                                                                            |
| [test-playback-checkpoint.mjs](../scripts/tests/system/test-playback-checkpoint.mjs)                   | 回归测试；本次未执行         | npm: `test:shutdown`；文档有运行说明                                                                                    |
| [test-playback-events.mjs](../scripts/tests/audio/test-playback-events.mjs)                           | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-playback-mode.mjs](../scripts/tests/library/test-playback-mode.mjs)                               | 回归测试；本次未执行         | npm: `test:playback-mode`；文档有运行说明                                                                               |
| [test-plugin-logs.mjs](../scripts/tests/plugins/test-plugin-logs.mjs)                                   | 回归测试；本次未执行         | npm: `test:plugin-logs`；文档有运行说明                                                                                 |
| [test-plugin-project-isolation.mjs](../scripts/tests/plugins/test-plugin-project-isolation.mjs)         | 回归测试；本次未执行         | npm: `test:plugin-project`                                                                                              |
| [test-plugin-proxy.cjs](../scripts/tests/plugins/test-plugin-proxy.cjs)                                 | 回归测试；本次未执行         | npm: `test:plugin-proxy`                                                                                                |
| [test-preference-defaults.mjs](../scripts/tests/library/test-preference-defaults.mjs)                   | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-qqmusic-source.mjs](../scripts/tests/plugins/test-qqmusic-source.mjs)                             | 回归测试；本次未执行         | npm: `test:qqmusic-source`                                                                                              |
| [test-recommendation-feedback.mjs](../scripts/tests/library/test-recommendation-feedback.mjs)           | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-recommendation-playlist.mjs](../scripts/tests/library/test-recommendation-playlist.mjs)           | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-recommendations.mjs](../scripts/tests/library/test-recommendations.mjs)                           | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-recover-moved-songs.mjs](../scripts/tests/library/test-recover-moved-songs.mjs)                   | 回归测试；本次未执行         | npm: `test:recover-moved-songs`                                                                                         |
| [test-remote-source-storage.mjs](../scripts/tests/plugins/test-remote-source-storage.mjs)               | 回归测试；本次未执行         | npm: `test:remote-sources`                                                                                              |
| [test-remote-sources.mjs](../scripts/tests/plugins/test-remote-sources.mjs)                             | 回归测试；本次未执行         | npm: `test:remote-sources`                                                                                              |
| [test-renderer-persistence.mjs](../scripts/tests/system/test-renderer-persistence.mjs)                 | 回归测试；本次未执行         | npm: `test:shortcuts`；文档有运行说明                                                                                   |
| [test-resource-lifecycle.mjs](../scripts/tests/system/test-resource-lifecycle.mjs)                     | 回归测试；本次未执行         | npm: `test:shutdown`；文档有运行说明                                                                                    |
| [test-scan-short-songs.mjs](../scripts/tests/library/test-scan-short-songs.mjs)                         | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-settings-search.mjs](../scripts/tests/ui/test-settings-search.mjs)                           | 回归测试；本次未执行         | npm: `test:settings-search`                                                                                             |
| [test-shortcuts.mjs](../scripts/tests/system/test-shortcuts.mjs)                                       | 回归测试；本次未执行         | npm: `test:shortcuts`                                                                                                   |
| [test-shuffle.mjs](../scripts/tests/library/test-shuffle.mjs)                                           | 回归测试；本次未执行         | npm: `test:shuffle`                                                                                                     |
| [test-song-lyrics.mjs](../scripts/tests/lyrics/test-song-lyrics.mjs)                                   | 回归测试；本次未执行         | npm: `test:song-lyrics`                                                                                                 |
| [test-song-search-ui.mjs](../scripts/tests/library/test-song-search-ui.mjs)                             | 回归测试；本次未执行         | npm: `test:song-search`                                                                                                 |
| [test-song-search.mjs](../scripts/tests/library/test-song-search.mjs)                                   | 回归测试；本次未执行         | npm: `test:song-search`                                                                                                 |
| [test-source-management.mjs](../scripts/tests/plugins/test-source-management.mjs)                       | 回归测试；本次未执行         | npm: `test:source-management`                                                                                           |
| [test-source-metadata.mjs](../scripts/tests/plugins/test-source-metadata.mjs)                           | 回归测试；本次未执行         | npm: `test:source-metadata`                                                                                             |
| [test-source-runtime.mjs](../scripts/tests/plugins/test-source-runtime.mjs)                             | 回归测试；本次未执行         | npm: `test:source-runtime`；文档有运行说明                                                                              |
| [test-spectrum-color.mjs](../scripts/tests/audio/test-spectrum-color.mjs)                             | 未接入统一入口；本次运行通过 | 未发现静态引用                                                                                                          |
| [test-statistics-controls.mjs](../scripts/tests/library/test-statistics-controls.mjs)                   | 回归测试；本次未执行         | 未发现静态引用                                                                                                          |
| [test-system-media-controls.cjs](../scripts/tests/audio/test-system-media-controls.cjs)               | 回归测试；本次未执行         | npm: `test:smtc`                                                                                                        |
| [test-taskbar-playback.mjs](../scripts/tests/audio/test-taskbar-playback.mjs)                         | 回归测试；本次未执行         | npm: `test:taskbar`                                                                                                     |
| [test-theme-contract.mjs](../scripts/tests/appearance/test-theme-contract.mjs)                             | 回归测试；本次未执行         | npm: `test:theme-contract`                                                                                              |
| [test-theme-package.mjs](../scripts/tests/appearance/test-theme-package.mjs)                               | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-theme-plugins.mjs](../scripts/tests/plugins/test-theme-plugins.mjs)                               | 回归测试；本次未执行         | npm: `test:theme-plugins`                                                                                               |
| [test-theme-preview.mjs](../scripts/tests/appearance/test-theme-preview.mjs)                               | 回归测试；本次未执行         | 文档有运行说明                                                                                                          |
| [test-thumbnail-playback.mjs](../scripts/tests/audio/test-thumbnail-playback.mjs)                     | 回归测试；本次未执行         | npm: `test:taskbar`                                                                                                     |
| [test-window-material.mjs](../scripts/tests/system/test-window-material.mjs)                           | 未接入统一入口；本次运行通过 | 未发现静态引用                                                                                                          |
| [test-window-presentation.mjs](../scripts/tests/system/test-window-presentation.mjs)                   | 未接入统一入口；本次运行通过 | 未发现静态引用                                                                                                          |
| [test-windows-runtime.cjs](../scripts/tests/system/test-windows-runtime.cjs)                           | 回归测试；本次未执行         | npm: `test:packaging-deps`                                                                                              |
| [test-ytdlp-preparation.mjs](../scripts/tests/system/test-ytdlp-preparation.mjs)                       | 回归测试；本次未执行         | npm: `test:packaging-deps`                                                                                              |
| [test_auto_mix_stem_worker.py](../scripts/tests/audio/test_auto_mix_stem_worker.py)                   | 回归测试；本次未执行         | CI 直接引用                                                                                                             |

### 性能测试（6 个文件）

| 文件                                                                                                      | 用途/状态               | 调用情况                                         |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| [benchmark-song-search.mjs](../scripts/performance/benchmark-song-search.mjs)                                         | 性能测量/原生性能子项目 | npm: `perf:song-search`                          |
| [check-liquid-glass-performance.cjs](../scripts/performance/check-liquid-glass-performance.cjs)                       | 性能测量/原生性能子项目 | npm: `test:liquid-glass:perf`                    |
| [check-playback-performance.cjs](../scripts/performance/check-playback-performance.cjs)                               | 性能测量/原生性能子项目 | npm: `perf:playback`；文档有运行说明             |
| [check-player-app.cjs](../scripts/performance/check-player-app.cjs)                                                   | 性能测量/原生性能子项目 | npm: `perf:app`；文档有运行说明                  |
| [native-performance/CMakeLists.txt](../scripts/performance/native/CMakeLists.txt)                         | 性能测量/原生性能子项目 | 文档通过 `scripts/performance/native` 子项目调用 |
| [native-performance/spectrum_analysis_test.cpp](../scripts/performance/native/spectrum_analysis_test.cpp) | 性能测量/原生性能子项目 | 文档通过 `scripts/performance/native` 子项目调用 |

### 测试辅助库（2）

| 文件                                                            | 用途/状态              | 调用情况        |
| --------------------------------------------------------------- | ---------------------- | --------------- |
| [lib/dsd-fixtures.mjs](../scripts/lib/dsd-fixtures.mjs)         | 测试数据或夹具生成辅助 | 被 1 个脚本引用 |
| [theme-plugin-fixture.cjs](../scripts/lib/theme-plugin-fixture.cjs) | 测试数据或夹具生成辅助 | 被 3 个脚本引用 |

### 测试夹具（2）

| 文件                                                                                                                              | 用途/状态            | 调用情况                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------ |
| [fixtures/plugin-v1/builtin.youtube-1.0.0-0198616128fe.epp](../scripts/fixtures/plugin-v1/builtin.youtube-1.0.0-0198616128fe.epp) | 插件旧版兼容测试数据 | 兼容性测试夹具目录；可能由目录路径间接读取 |
| [fixtures/plugin-v1/catalog.json](../scripts/fixtures/plugin-v1/catalog.json)                                                     | 插件旧版兼容测试数据 | 兼容性测试夹具目录；可能由目录路径间接读取 |

### 样例生成器（2）

| 文件                                                      | 用途/状态            | 调用情况       |
| --------------------------------------------------------- | -------------------- | -------------- |
| [create-nyan-theme.mjs](../scripts/examples/create-nyan-theme.mjs) | 固定样例生成；可归档 | 未发现静态引用 |
| [create-theme-demo.mjs](../scripts/examples/create-theme-demo.mjs) | 固定样例生成；可归档 | 未发现静态引用 |

### 手工预览（1）

| 文件                                                      | 用途/状态        | 调用情况       |
| --------------------------------------------------------- | ---------------- | -------------- |
| [lyrics-v2-preview.mjs](../scripts/dev/lyrics-v2-preview.mjs) | 手工交互预览服务 | 文档有运行说明 |

## 建议目录组织

优先修复失效入口并建立分组命令，再考虑移动文件。长期可将生产工具置于 build/、prepare/、package/、plugins/、maintenance/ 等子目录；测试迁入 tests/scripts/（按 unit、integration、ui、performance 划分）；固定样例生成与手工预览放在 tools/examples/ 和 tools/dev/。这是目录建议，本次没有移动或删除现有脚本。移动时需要同步 package.json、工作流、electron-builder.yml、CMake、自引用和相对导入；脚本间接调用较多，不宜批量移动后仅检查文件名。
