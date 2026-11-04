# Nyan Cat 主题插件

原主题保留在 nyan-cat/ 与 nyan-cat.theme.zip，供资源归属和迁移参考；旧格式的新导入/导出入口已移除，已有旧主题仍可选择或删除。当前插件配置与资源位于独立仓库 easy-player-plugin/examples/nyan-cat，配色与发布验收见 [第三方主题适配指南](../theme-authoring.md)。

转换沿用原第三方主题规则：

- 插件 manifest.json 声明 kind: theme、apiVersion: 2、sources: []，第三方 ID 使用 example.nyan-cat。
- 原资源清单中的 resources、slots、text、licenses 放入插件 theme.json 的 assets 对象。图片、字体、插槽、文本和字体授权保持原样。
- 原 theme.json 的 tokens、rules 保留，使用同一套安全 CSS 语法与组件选择器校验。插件另声明 colorMode、背景回退和窗口配色。
- 原 background: replace 由外观中的背景选择取代。插件启用后，选择 Nyan Cat 并使用深色模式。

在插件仓库运行：

```sh
node scripts/pack-theme.mjs examples/nyan-cat dist/examples
```

也可以在本应用仓库运行 `npm run pack:themes`，将本目录的旧格式源码转换后，与哥伦比娅主题一起打包。产物分别位于 `build/themes/nyan-cat/` 和 `build/themes/columbina/`。此命令复用同级 `easy-player-plugin` 仓库的标准打包器；其他位置可通过 `EASY_PLAYER_PLUGIN_DIR` 指定。

使用包含资源主题插件支持的新版宿主，在「设置 → 插件 → 导入本地包」选择生成的 .epp，启用后在外观中选择该主题。切换主题、停用和卸载会移除插件的样式、字体和文本。
