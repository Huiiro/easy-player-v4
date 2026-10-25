# 主题插件维护与开发约定

整体架构、来源调用与发布流程见 [插件系统总览](plugin-system.md)。

主题插件协议固定为 SDK 2.1、插件 API 2、主题数据格式 1。完整制作规范、容量限制与示例位于独立仓库的 [THEMES.md](https://github.com/Huiiro/easy-player-plugin/blob/master/THEMES.md)。本仓库维护公共 SDK、Schema 和宿主加载器；插件仓库维护主题源码、打包工具和官方分发索引。

## 公共契约

- SDK 类型：[themes.ts](../packages/plugin-sdk/src/themes.ts)。
- 编辑器与打包校验：[插件清单 Schema](../packages/plugin-sdk/schemas/theme-plugin-manifest.schema.json)、[主题数据 Schema](../packages/plugin-sdk/schemas/theme.schema.json)。二者随 SDK npm 包分发。
- 主进程声明校验：[themePlugins.ts](../src/shared/themePlugins.ts)，资源槽位沿用 [themePackage.ts](../src/shared/themePackage.ts)，CSS 语法共用 [themeStyles.ts](../src/shared/themeStyles.ts)。
- 安装与资源边界：[themePackage.ts](../src/main/plugins/themePackage.ts)、[packages.ts](../src/main/plugins/packages.ts)、[themeProtocol.ts](../src/main/plugins/themeProtocol.ts)。
- 渲染与清理：[DeclarativeThemeBackground.vue](../src/renderer/src/components/background/DeclarativeThemeBackground.vue) 处理声明式静态/shader 背景，[SandboxedThemeBackground.vue](../src/renderer/src/components/background/SandboxedThemeBackground.vue) 处理沙箱代码背景；样式与订阅由 [customTheme.ts](../src/renderer/src/services/customTheme.ts)、[pluginThemes.ts](../src/renderer/src/services/pluginThemes.ts) 管理。

渲染入口按实现方式命名，与官方/第三方来源身份分开。两者共用插件安装、启停和更新流程；沙箱代码入口目前仍仅向认证的官方包开放。

契约变更必须同步类型、校验、Schema、文档和测试。修改已发布协议含义需要版本策略；当前 SDK 2.1 尚处于本轮待发布改动中。新增字段或槽位应明确宿主版本与回退方式，不依赖作者自行写内部 URL、字体族或 DOM 注入。

## 双仓库维护流程

在本仓库执行：

```sh
npm run sync:theme-contract
npm run test:theme-contract
npm run build:plugin-sdk
npm run typecheck
npm run build:plugins
npm run test:theme-plugins
npm run test:official-plugins
npm run build:nocheck
npm run test:appearance
npm run test:plugin-project
```

sync:theme-contract 将 SDK 的两个 Schema 与版本/哈希快照同步到独立插件仓库 schemas/；通过 EASY_PLAYER_PLUGIN_DIR 指定非同级目录。这个命令属于 SDK 维护流程，普通应用构建与主题制作不读取另一个仓库。来源插件可继续固定 SDK 2.0，Schema 更新不会强制重建其代码契约。

在插件仓库运行 npm ci --ignore-scripts、npm run build、npm run build:examples 和 npm test。构建后提交官方 catalog.json；应用 resources/plugins/catalog.json 是离线种子，由 build:plugins 同步，不包含插件可执行内容。第三方示例不进入官方索引。

## 生命周期与兼容

安装 .epp 采用插件流程，导入后需在外观中选择；旧 .theme.json/.theme.zip 保持原自定义主题入口及 10 秒确认行为。两者共用 CSS/资源规则，原包不自动迁移或删除。[Nyan Cat 转换说明](themes/nyan-cat-plugin.md) 展示字段对应关系。

配色、规则、资源与文本只在插件选中且其设计模式匹配时生效。用户自定义主题保留优先级，选中插件背景时不显示旧自定义主题背景。原生窗口材质或启用的自定义主题背景可暂时覆盖插件背景，偏好保持不变。

运行数据不进入持久化 UI 偏好；偏好只保存背景 ID。启停、更新及卸载通过现有插件变化事件触发各窗口重载。字体使用加载代次阻止过期异步结果附着；切换时移除字体与样式；shader 在卸载前隐藏画布、取消请求/动画、释放 GPU 和事件监听。

安装包按 SHA-256 固定版本。未启用、已卸载、旧哈希、未声明资源均由协议拒绝。更新失败保留原安装指针及活动主题；显示阶段的 shader 编译或硬件故障保留背景回退并提示，不撤销安装。坏包启动失败不会阻止其他插件加载。

旧场景名称不再映射为插件 ID，旧配置回到默认无背景；新的 plugin:<id> 选择在未安装时回退并保留，安装后恢复。已发布 API 1 来源与 SDK 2.0 / API 2 来源继续兼容。仅有 API 2 来源能力的旧宿主尚不能安装主题；发布时应先交付主题宿主，再更新官方索引，当前不提供 minAppVersion 自动协商。

## 验证边界

契约测试覆盖 Schema/宿主声明一致性及原资源槽位一致性；主题包测试覆盖真实安装、重启、错误更新、提交失败回滚、资源访问与卸载。界面测试使用真实 Pinia、主题组件、应用 CSP、资源协议与 GPU shader；同时检查 CSS 覆盖、字体加载与清理。原 JSON/ZIP 导入、字体字形、预览确认和来源插件回归继续保留。

插件项目隔离测试将整个工程复制到应用外，独立安装、构建、测试并比较目录移动前后的官方哈希；打包测试另比较 LF/CRLF 输入。原生平台材质和不同 GPU 的实际表现仍需在目标系统验收。

## 作者与身份

PluginManifest 可选 author: { name, url? }，SDK、Schema、安装存储、官方索引比较与主题 DTO 均保留该字段。旧包不声明作者仍兼容；作者不能影响 origin 或绕过索引校验。界面将名称作为展示、ID 作为身份：不同 ID 的重名可并存，相同 ID 为更新。作者名同样可重复，不是签名或发布者认证；第三方 ID 建议使用自己维护的账号或组织命名空间。

雨夜迁移补充通用 image 纹理：图片保留在插件包中，宿主解码后核对声明尺寸，按 WebGL 方向上传并生成 mipmap。shader.fps 可选 1–30，雨夜使用 24。旧源码中的雨滴算法、街景图片、色板与归属记录已移至独立仓库 themes/rainy；应用只保留通用纹理加载。

## 官方背景渲染器

八个 Canvas/SVG/CSS 主题已迁入插件仓库，具体映射、源码与隔离边界见 [迁移说明](themes/official-scenes.md)。PluginThemeData.renderer 是官方专用入口，和 shader 互斥；未认证的本地主题始终拒绝此代码。主进程只提供校验后的字节，SandboxedThemeBackground 在不透明来源的沙箱框架中执行，没有 Node、preload 或宿主 API。宿主生成 HTML 与 CSP，双方仅通过来源校验后的 paused/dispose、ready/failed 消息协作。
