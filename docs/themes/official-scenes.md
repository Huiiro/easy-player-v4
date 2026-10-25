# 八个个性化背景迁移

极光、深海、日落、森林、矩阵、星空、星轨和 DNA 双螺旋已迁入独立插件仓库，均为单独的官方主题包，初始版本 1.0.0。

| 原背景偏好 | 插件 ID                  | 插件源码          |
| ---------- | ------------------------ | ----------------- |
| aurora     | builtin.theme.aurora     | themes/aurora     |
| ocean      | builtin.theme.ocean      | themes/ocean      |
| sunset     | builtin.theme.sunset     | themes/sunset     |
| forest     | builtin.theme.forest     | themes/forest     |
| matrix     | builtin.theme.matrix     | themes/matrix     |
| starfield  | builtin.theme.starfield  | themes/starfield  |
| startrails | builtin.theme.startrails | themes/startrails |
| dna        | builtin.theme.dna        | themes/dna        |

旧版场景名称不再兼容或映射，读取旧配置时回到默认无背景。用户需从已启用插件中重新选择；新的 plugin:<id> 选择在插件停用时回退并保留，重新启用后恢复。应用继续提供无背景、跟随歌曲及本地图片/视频能力。

## 保留的内容

各目录的 Background.vue 保留原 Canvas/SVG/CSS 场景几何、缓存、画布分辨率限制与动画节奏；只将焦点归属交给宿主的 paused 状态。原深色配色与遮罩迁入 theme.json，素材移入各主题的 assets。星轨 SVG 在构建时内嵌为图片数据，运行时不引用应用路径。

scripts/build-renderer-themes.mjs 编译组件、作用域样式和 themes/runtime.ts，生成无外部模块依赖的 background.js，并收集 Vue 运行时依赖的 MIT 许可。Vue 与编译器是插件仓库固定的开发依赖；插件运行不读取应用 Vue 模块或源码。

## 官方渲染入口

```json
{ "renderer": { "entry": "background.js" } }
```

renderer 与 shader 互斥，脚本最大 2 MiB。该入口仅在固定官方索引/种子认证的主题中开放。未认证的第三方包即使使用相同目录结构、复制官方代码或冒用 builtin. ID，也不能安装代码入口。第三方仍使用数据、资源与 shader 主题。

主进程只保存、校验和提供脚本字节，不 require/eval 主题脚本。HTML 外壳由宿主生成，包不能提供任意 HTML。SandboxedThemeBackground.vue 在 sandbox="allow-scripts" 的框架内加载它，不启用 allow-same-origin、Node、preload、弹窗或宿主 API。

框架使用不透明来源和独立 CSP：仅加载该版本声明的脚本，禁止 fetch/WebSocket 等连接及嵌套框架，仅允许背景所需的内联样式与受限图片来源。宿主窗口只增加主题资源的 frame-src，主窗口 script-src 保持原策略。

宿主到框架只发送 paused 与 dispose；框架只报告 ready/failed。父子均验证消息 source，宿主不会执行来自主题的命令。暂停覆盖窗口隐藏/失焦、减少动态效果和播放页遮挡；移除框架销毁其文档、定时器和图形资源。加载超时或失败时显示静态回退并提示。

这是官方背景的 DOM/能力隔离，不承诺独立 OS 进程或 CPU/内存硬配额，也不开放第三方脚本插件。

## 构建、验证与分发

在插件仓库运行 npm run build、npm test；宿主通过 npm run build:plugins 同步包与离线种子。每个主题生成独立 .epp，经官方发布工作流上传。共享 runtime 或 Vue 依赖变化可能改变八个包，已发布后应分别递增受影响插件版本。

本地验证可在包含此渲染能力的新版应用中，逐个导入 .epp 并启用；随后在外观中选择。离线导入通过应用种子中的哈希认证，不依赖远端索引已更新。

回归包含八个真实框架的绘制、动画、暂停、明暗切换、停用/恢复，验证 Node/preload/API 不可见和父文档不可访问；同时校验第三方代码拒绝、资源门禁、重启恢复、独立目录构建和产物哈希。原源码与静态 SVG 已从宿主构建输入移除。
