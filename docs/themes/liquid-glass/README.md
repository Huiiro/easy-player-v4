# Liquid Glass / 流光玻璃

本独立主题及已生成的 `.epp` 包继续保留。另有可叠加任意主题/自定义背景的[内置 Liquid Glass Studio 开关](../../liquid-glass-studio.md)，直接使用上游 WebGL 着色器；启用内置开关时暂停本主题的 SVG 折射，关闭后恢复。

独立第三方 `.epp` 主题，API 2 / 格式 1，设计模式为深色。需要包含 `glass` 扩展的 Easy Player 宿主；旧宿主不会生成 SVG 折射，不能以 API 2 判断是否支持此扩展。

在「设置 → 插件 → 导入本地包」导入安装包并启用，然后在外观中选择「流光玻璃」，选择深色模式并关闭原生窗口材质。

```sh
npm run pack:theme -- docs/themes/liquid-glass docs/theme_plugin
```

命令复用同级 easy-player-plugin 仓库打包器（也可通过 EASY_PLAYER_PLUGIN_DIR 指定）。主题目录可单独复制到插件工程，无需宿主内部源码。`npm run pack:themes` 也会生成此包到 build/themes/liquid-glass。

1.2.0 增强了窄边缘的彩色棱光，并修复交互卡顿。真实背景 RGB 分采样更明显，静态棱彩边光在纯色背景上也可见；后者是烘焙的视觉近似，不会污染高透中心。菲涅尔反射、高光和彩光合并为缓存的透明背景层，避免每帧重复整面板合成。几何仍使用连续的圆弧 Snell 折射，8px 倒角限制在短边的 20% 内。

列表悬停、歌词状态和进度更新不再重写玻璃样式或重设相同的光照矩阵。滚动、输入与拖动时使用缓存的单通道折射，保留相同彩色边光；停止 180ms 后恢复完整 RGB 色散。普通鼠标移动不会触发切换或改变光照。性能基准见下方命令，本机结果不代表所有硬件。

默认固定光照，不受页面其他位置的鼠标移动影响；可选 interactive 只在当前玻璃内产生小幅局部响应。模糊从 8px 降为 0.5px，Header/Footer、侧栏、弹窗与菜单染色为 4–12%，移除了叠加的大片白色高光渐变，并关闭弹窗遮罩的额外背景模糊。真实 glass 菜单通过公开材质变量跟随主题透明度，不再保留局部 90% 不透明底色。

渲染直接采样 Chromium 实时 DOM 背景，文字与输入保持清晰。CPU 只生成几何和静态光照图，没有窗口截图、DOM 快照、网络资源或空闲动画循环。面板改变大小、圆角、出现或移除时自动更新；停用与切换时清理观察器、交互定时器、事件和图像资源。无硬件加速时仍可显示缓存的静态彩光，背景折射降级为 CSS 材质。

参数和限制见 [作者指南](../../theme-authoring.md#liquid-glass-折射扩展)。在 `theme.json` 的 `glass` 调整厚度、折射率、色散、反射、高光方向和阴影，各面板染色通过 tokens/rules 调整。主按钮、危险操作、焦点和禁用状态沿用宿主语义。迷你窗口只同步配色。

这是网页合成器上的 Apple 风格光学重现，不是 Apple 私有系统材质，也不提供 HDR 环境反射或相邻形状融合。玻璃本身不能保证任意背景上的文字对比度，浅色高亮背景仍需单独验收。

参考与授权：

- [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio)：改编边缘入射角与 RGB 偏移模型，保留 Charles Yin 的 [MIT 授权](licenses/liquid-glass-studio.txt)。其 WebGL/WebGPU 演示使用图片/视频纹理，本实现将光学计算接到 DOM backdrop 上，没有引入 React、演示媒体或纹理截图依赖。授权同时随独立 `.epp` 和宿主 `resources/licenses` 分发。
- [greyd097/yzrt 的纯 CSS 液态玻璃](https://gitee.com/greyd097/yzrt/tree/master/)：仅观察分层反光与阴影的视觉效果，没有复制或分发该 GPL-2.0 项目的代码或素材。

验证：`npm run test:liquid-glass` 检查 Snell/Fresnel 数学、DPR 与像素预算、实际 GPU 折射/色散/反射/高光/阴影、实时背景、缩放、Teleport、指针和减少动态效果、真实 Vue 菜单/弹窗的点击输入及完整清理。软件合成降级可设置 `EP_GLASS_SOFTWARE=1` 验证，2 倍 DPI 可设置 `EP_GLASS_DPR=2` 验证。

性能：`npm run test:liquid-glass:perf` 在隔离的 GPU 窗口中对比关闭/启用玻璃：1440×900、4 个面板、200 行歌曲，90 帧滚动、类名/进度变化及输入。输出中位数/P95 帧耗时，并断言无重复样式写入、光照写入、几何图重建，以及交互质量恢复；报告位于 `build/themes/liquid-glass/performance-after.json`。性能测试应单独运行，避免其他 GPU 测试影响结果。
