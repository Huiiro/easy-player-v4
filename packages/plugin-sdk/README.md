# Easy Player Plugin SDK

宿主架构、运行流程及维护分工见 [插件系统总览](../../docs/plugin-system.md)。

`@easy-player/plugin-sdk@2.1.0` 提供纯契约与插件定义辅助函数，不依赖 Electron、应用数据库、UI、播放器状态或应用源码。

```sh
npm ci --ignore-scripts
npm run build
npm pack
```

发布给插件维护者的是包含 `dist/*.js` 和 `dist/*.d.ts` 的版本化 npm 包或 `.tgz`。[独立插件仓库](https://github.com/Huiiro/easy-player-plugin) 将该包固定在 `vendor/` 中；插件通过包名引用，不能引用 SDK 源码的相对路径。应用根命令 `npm run build:plugin-sdk` 生成 `build/` 下的 `.tgz`，再由插件仓库更新 vendor、依赖与锁文件。

API v2 的 `defineSourcePlugin(source, create, version, author?)` 显式注册来源；可选的第四个参数 author 会写入插件清单，供索引和已安装列表显示维护者信息。`PluginHostContext` 提供网络、配置、日志、资源回收和可选的媒体信息查询能力。每次调用的 `SourceCallContext` 提供取消信号、截止时间和所属插件的宿主服务。播放器模式由宿主决定，不是插件全局状态。

`media.extractInfo` 只接受 URL 或查询及条数，返回 JSON 信息；宿主构建工具参数、负责进程和取消。插件不接收保存目录或任务、窗口身份。文件标签写入和数据库同步不在 SDK 中。

`SourceCallError` 仅携带稳定错误代码；应用负责本地化。SDK v2 的插件清单声明 API 2，旧应用应拒绝安装；新应用继续通过兼容桥接装载 API 1 的已发布包。来源能力的数据协议仍为 `NetworkSource.apiVersion = 1`。

修改公共契约时，先更新 SDK 版本并构建 `.tgz`，再更新插件项目的依赖和锁文件；应用兼容代码与插件源码分别维护。

SDK 2.1 增加 PluginThemeManifest、PluginThemeData、InstalledPluginTheme 和主题类清单字段。主题仍声明插件 API 2，通过主题加载器安装，不使用主进程 createPlugin 或 activate 脚本。既有来源插件可继续固定使用 SDK 2.0；API 1/2 来源兼容行为不变。

PluginThemeData 的 tokens、rules、assets 沿用第三方主题的安全 CSS 语法、资源清单、插槽及文本规则；PluginThemeAssets 声明本地字体、图片和授权文件。资源仅由宿主校验后通过活动插件的版本化协议提供，不接受任意 URL 或脚本。

主题协议开发规范见 [维护约定](../../docs/theme-plugins.md)。SDK 包同时包含 schemas/theme-plugin-manifest.schema.json 与 schemas/theme.schema.json；宿主运行 npm run sync:theme-contract 同步独立插件仓库快照，npm run test:theme-contract 验证一致性。主题包打包器在独立仓库消费固定 Schema，运行时最终校验由宿主管理。

当前宿主的配色与明暗适配见 [第三方主题适配指南](https://github.com/Huiiro/easy-player-v4/blob/master/docs/theme-authoring.md)，具体变量见 [主题变量参考](https://github.com/Huiiro/easy-player-v4/blob/master/docs/theme-variables.md)。`colorMode` 仅声明设计模式，不改变用户偏好；匹配模式时才应用设计专用样式与槽位。主按钮由有效填充计算黑/白前景和悬停色，独立改背景时需同时适配前景；背景和控件由宿主在资源就绪后统一过渡，默认使用 `--motion-duration-theme`（220ms）。这些为宿主行为说明，未新增 SDK 字段或改变主题格式版本。

PluginManifest.author 可声明 PluginAuthor（name、可选 HTTPS url），作为维护者展示元信息；旧包可省略。displayName 与作者可重复，插件身份和更新始终以 id 为准。作者字段不授予官方身份，也不提供签名认证。

主题 shader 纹理支持 rg32f 查表与 image 图片，均声明 width/height；宿主对图片解码尺寸校验并提供 mipmap。shader.fps 可选 1–30，默认 30。制作雨夜等图片背景需要相应新版宿主，原浮点纹理主题保持兼容。

官方主题可选 renderer: { entry }，与 shader 互斥。此字节入口只在官方索引/种子认证后提供，在无 Node、preload、宿主 API 的不透明来源框架中运行；第三方主题拒绝该入口。InstalledPluginTheme.rendererUrl 由宿主生成，客户端不得自行指定任意页面。

插件主动诊断使用现有 host.log(level, message)；宿主绑定插件身份与激活版本。日志查看、脱敏和维护约定见 [插件日志](../../docs/plugin-logging.md)。

Liquid Glass 组件材质新增公开 `--ep-glass-*` tokens，包括圆角、浮层模糊、底色比例、边框、高光、阴影，以及开关/滑块/进度条/骨架颜色。SDK 导出 `THEME_GLASS_TOKENS` 变量目录、`PluginThemeGlassToken` 键名类型和 `PluginThemeTokens`，`PluginThemeData.tokens` 保留已有语义变量并提供玻璃变量补全；`schemas/theme.schema.json` 同步提供默认值和说明。参数配置用户开启的内置玻璃叠加效果，不会自行开启全局开关。`.ep-message`、`.ep-color-trigger`、`.ep-switch-track`、`.ep-glass-panel` 是新增公开规则钩子；内部 data 属性不属于作者 API。宿主 uiDEV `/dev/ui` 可操作预览并生成 tokens/rules 片段，完整清单见主题变量参考。

BackTop 使用公开 `.ep-backtop` 钩子；`THEME_BACKTOP_TOKENS` / `PluginThemeBackTopToken` 和 `PluginThemeTokens` 提供 size、radius、right、bottom 四个几何变量的补全，Schema 同步说明。几何变量也适用于未开启玻璃的主题；开启时复用已有玻璃染色、边缘和阴影参数，不自动改变用户的效果开关。

Tooltip 使用 `.ep-tooltip`、`.ep-tooltip--control` 和 `.ep-tooltip-trigger` 公共钩子，`THEME_TOOLTIP_TOKENS` / `PluginThemeTooltipToken` 提供底色、文字、边框、圆角、阴影、字号、内边距、最大宽度及竖向调节面板尺寸补全。变量同时适用于普通主题和 Liquid Glass；开启玻璃后缺省跟随浮层材质，显式 Tooltip 属性仍可覆盖。Schema、uiDEV 示例和属性表已同步。
