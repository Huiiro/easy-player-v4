# 工程脚本

所有命令均从仓库根目录运行，优先使用 `npm run <命令>`。现有 npm 命令名称保留。

| 目录                | 用途                                                   |
| ------------------- | ------------------------------------------------------ |
| `build/`            | 原生模块、任务栏和 macOS 构建，原生产物归集            |
| `prepare/`          | 音频依赖、FFmpeg、fpcalc、yt-dlp、人声分离运行时准备   |
| `package/`          | 平台安装包、可选组件打包，打包前后校验和 NSIS 文件关联 |
| `plugins/`          | 独立插件工程桥接、主题打包、官方插件和 SDK 契约同步    |
| `maintenance/`      | 旧曲库迁移、yt-dlp 版本锁更新                          |
| `lib/`              | 构建和测试共享库；通常不能直接执行                     |
| `tests/audio/`      | 音频、Auto Mix、指纹运行依赖、SMTC、任务栏             |
| `tests/appearance/` | 主题、动态背景、Liquid Glass 和颜色                    |
| `tests/library/`    | 曲库导入、查重、搜索、推荐、统计和排序                 |
| `tests/lyrics/`     | 歌词解析、编辑、动画和桌面歌词                         |
| `tests/plugins/`    | 插件、网络源、媒体下载及文件传输                       |
| `tests/system/`     | 更新、窗口、迁移、持久化、运行库和资源生命周期         |
| `tests/ui/`         | 页面、列表、布局、交互和跨平台运行验证                 |
| `fixtures/`         | 旧插件格式兼容测试数据，随对应测试保留                 |
| `performance/`      | 性能基准；`native/` 为独立 CMake 频谱测试              |
| `examples/`         | 固定主题样例再生成工具，从日常脚本中归档               |
| `dev/`              | 手工歌词预览，不属于自动测试                           |

## 运行与前置条件

- `npm run test:script-layout` 检查 npm、CI、打包配置及脚本相对导入，防止目录移动留下失效入口。
- `npm run test:background-cleanup` 检查背景资源释放、离场和流体运动；原失效源码路径与组件 mock 已修复。
- `npm run test:window-material-unit`、`npm run test:window-material-native` 分别检查窗口材质逻辑和真实 Electron 调用。
- `npm run test:window-presentation`、`npm run test:lyrics-contrast`、`npm run test:spectrum-color` 提供原未接入入口的回归检查。
- 音频、任务栏和安装包测试需要先构建对应原生模块及包，不能以缺少构建产物判定测试过期。
- 插件桥接默认使用相邻 `easy-player-plugin` 仓库，也可设置 `EASY_PLAYER_PLUGIN_DIR`。部分主题/插件集成测试还需要 `npm run build:plugins` 生成匹配的本地包。
- `examples/` 中的生成器会重写固定主题样例；通常只在重建样例时运行。现有主题资源及许可文件仍供测试使用。
- `dev/lyrics-v2-preview.mjs` 启动本地 5197 端口的手工预览服务。

## 新增脚本

按功能放入对应目录，同时维护 npm 或文档入口。使用 `import.meta.url`、`__dirname` 定位仓库时检查目录层级；更新 Python `parents[]`、PowerShell `$PSScriptRoot` 和 CMake 相对目录。外部插件仓库的脚本路径独立维护，不能随主仓库路径批量替换。
