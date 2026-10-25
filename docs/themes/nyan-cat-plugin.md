# Nyan Cat 主题插件

原主题保留在 nyan-cat/ 与 nyan-cat.theme.zip，继续支持原自定义主题入口。插件配置与资源位于独立仓库 easy-player-plugin/examples/nyan-cat。

转换沿用原第三方主题规则：

- 插件 manifest.json 声明 kind: theme、apiVersion: 2、sources: []，第三方 ID 使用 example.nyan-cat。
- 原资源清单中的 resources、slots、text、licenses 放入插件 theme.json 的 assets 对象。图片、字体、插槽、文本和字体授权保持原样。
- 原 theme.json 的 tokens、rules 保留，使用同一套安全 CSS 语法与组件选择器校验。插件另声明 colorMode、背景回退和窗口配色。
- 原 background: replace 由外观中的背景选择取代。插件启用后，选择 Nyan Cat 并使用深色模式。

在插件仓库运行：

```sh
node scripts/pack-theme.mjs examples/nyan-cat dist/examples
```

使用包含资源主题插件支持的新版宿主，在「设置 → 插件 → 导入本地包」选择生成的 .epp，启用后在外观中选择该主题。切换主题、停用和卸载会移除插件的样式、字体和文本。
