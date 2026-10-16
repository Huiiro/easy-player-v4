# 自定义主题

携带图片、字体及指定区域文字时，使用带 `manifest.json` 的 ZIP 主题包，见 [主题包说明](theme-packages.md)。清单格式可参考 [JSON Schema](themes/manifest.schema.json)。

设置 → 外观 → 自定义主题：下载示例，编辑 JSON 后导入。导入后立即启用，并随 UI 偏好保存到本地数据库，重启自动恢复。可切换、导出或删除主题；选择“默认（不覆写）”会恢复当前内置主题。重置外观会停用覆写，保留已导入文件。

主题默认接管整个主界面的背景（`background: "replace"`），以免与原有图片、视频或动态背景混搭。`--ep-app-bg` 控制背景，未设置时使用 `--color-bg`；支持颜色及 CSS 渐变，也可以通过 `.ep-app-background` 覆写。原背景偏好会保留，停用主题后恢复。需要保留原背景时显式设置 `background: "inherit"`。旧主题省略该字段也默认覆盖背景。

每份文件上限 128 KB，最多保存 20 个主题。名称区分大小写，同名导入替换原主题。格式错误不会替换当前主题。

```json
{
  "version": 1,
  "name": "Ocean Glass",
  "background": "replace",
  "tokens": {
    "--color-primary": "#38bdf8",
    "--ep-app-bg": "linear-gradient(135deg, #102536, #151121)",
    "--ep-sidebar-bg": "color-mix(in srgb, var(--color-bg) 90%, #38bdf8)",
    "--ep-sidebar-active-bg": "#38bdf833",
    "--ep-button-radius": "0.75rem",
    "--ep-dialog-radius": "1.5rem",
    "--ep-progress-fill": "#38bdf8"
  },
  "rules": {
    ".ep-dialog-panel": { "border": "1px solid var(--color-border)" },
    ".ep-button--primary:hover": { "filter": "brightness(1.1)" }
  }
}
```

## 变量与公共类

基础变量见 `src/renderer/src/styles/theme.css`，组件变量及默认材料见 `src/renderer/src/styles/components.css`。允许的变量前缀：`--color-`、`--btn-`、`--scrollbar-`、`--app-`、`--ep-`、`--lrc-`、`--motion-`。

| 部分         | 稳定类                                                                                                            | 主要变量                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 侧边栏       | `.ep-sidebar`、`.ep-sidebar-item`、`.ep-sidebar-item--active`                                                     | `--ep-sidebar-bg`、`--ep-sidebar-text`、`--ep-sidebar-active-bg`、`--ep-sidebar-active-text`、`--ep-sidebar-item-radius` |
| 按钮         | `.ep-button`、`.ep-button--primary` / `--secondary` / `--ghost` / `--danger`                                      | `--ep-button-radius`、`--btn-primary-*`、`--btn-danger-*`                                                                |
| 滑块         | `.ep-slider`、`.ep-progress-track`、`.ep-progress-fill`、`.ep-progress-thumb`                                     | `--ep-progress-track`、`--ep-progress-fill`、`--ep-progress-thumb`                                                       |
| 播放进度     | `.ep-range`、`.ep-playback-progress`                                                                              | `--ep-progress-track`、`--ep-progress-fill`                                                                              |
| 对话框       | `.ep-dialog`、`.ep-dialog-panel`、`.ep-dialog-header`、`.ep-dialog-title`、`.ep-dialog-body`、`.ep-dialog-footer` | `--ep-dialog-bg`、`--ep-dialog-radius`、`--ep-surface-shadow`                                                            |
| 抽屉         | `.ep-drawer`、`.ep-drawer-panel`、`.ep-drawer-header`、`.ep-drawer-body`、`.ep-drawer-footer`                     | `--ep-dialog-bg`、`--ep-surface-shadow`                                                                                  |
| 遮罩         | `.ep-overlay`                                                                                                     | `--ep-overlay-bg`                                                                                                        |
| 输入、选择   | `.ep-input`、`.ep-select`、`.ep-select-options`                                                                   | `--color-border`、`--color-text`、`--color-primary`                                                                      |
| 菜单、浮层   | `.ep-menu`、`.ep-popover`                                                                                         | `--color-bg-l`、`--color-border`                                                                                         |
| 开关         | `.ep-switch`、`.ep-switch-thumb`                                                                                  | `--ep-switch-active`、`--ep-switch-inactive`                                                                             |
| 标题栏、底栏 | `.ep-header`、`.ep-footer`                                                                                        | `--app-header-bg`、`--app-footer-bg`、`--app-chrome-border`                                                              |

`rules` 接受单个 `ep-*` 类、空格连接的后代类，以及 `:hover`、`:focus-visible`、`:disabled`。传送到 body 的对话框、菜单同样可以命中。不要依赖 Vue 的 scoped 属性或 Tailwind 编译产生的选择器。

变量覆写优先于内置主题及运行时变量；组件规则在默认样式后加载。对于尺寸、定位等运行时内联样式，优先使用组件公开的变量或属性。文件不接受脚本、原始 CSS、URL、import、转义和 `!important`，以免导入时产生外部资源请求或破坏样式边界。导出仅包含原主题声明，不会包含整个设置或本机路径。

## 底栏布局

设置 → 播放器 → 自定义底栏布局可切换「居中进度」「顶部进度线」，调整最大宽度和进度区域占比，区域间距使用默认 20px，窄窗口自动压缩间距。「恢复默认」按钮位于布局选择同一排。播放按钮和进度条始终对齐底栏中心，修改即时生效并自动保存。旧版“独立一行”设置自动使用顶部进度线。顶部模式仅绘制已播放轨道，播放时间显示在控制按钮右侧，按钮组仍对齐底栏中心。

启用时用户设置优先于主题变量；关闭或恢复默认后继续跟随主题。窄窗口自动采用顶部进度线。功能区根据实际可用宽度依次将收藏、不喜欢、桌面歌词、播放模式等操作收进“更多”，极窄时也提供队列与音量入口。窗口变宽后按钮自动恢复。

默认底栏最大宽度为 1320px，中间区域比例为 2.2fr；网格采用对称五列，歌曲信息跨前两列，保证右侧按钮变化不会使播放区偏移。

| 变量                                 | 含义                                     |
| ------------------------------------ | ---------------------------------------- |
| `--ep-footer-max-width`              | 底栏最大宽度                             |
| `--ep-footer-gap`                    | 区域间距                                 |
| `--ep-footer-columns`                | 对称五列网格宽度                         |
| `--ep-footer-areas`                  | 网格区域排列                             |
| `--ep-footer-playback-display`       | 默认 grid，顶部进度线使用 contents       |
| `--ep-footer-transport-area`         | 播放按钮网格区域，默认 auto              |
| `--ep-footer-progress-position`      | 默认 static，顶部进度线为 absolute       |
| `--ep-footer-progress-inset`         | 顶部进度线的边距                         |
| `--ep-footer-progress-transform`     | 顶部进度线垂直对齐                       |
| `--ep-footer-progress-columns`       | 默认时间/轨道/时间三列；顶部模式为一列   |
| `--ep-footer-progress-times-display` | 轨道两侧时间是否显示                     |
| `--ep-footer-unplayed-color`         | 顶部模式设为 transparent，隐藏未播放轨道 |
| `--ep-footer-show-unplayed`          | 顶部模式为 0，普通模式为 1               |
| `--ep-footer-top-time-display`       | 控制按钮右侧时间是否显示                 |

例如顶部进度线的主题变量：

```json
{
  "--ep-footer-max-width": "1400px",
  "--ep-footer-areas": "\"info info transport actions toggle\"",
  "--ep-footer-playback-display": "contents",
  "--ep-footer-transport-area": "transport",
  "--ep-footer-progress-position": "absolute",
  "--ep-footer-progress-inset": "0 24px auto",
  "--ep-footer-progress-transform": "translateY(-50%)",
  "--ep-footer-progress-columns": "minmax(0,1fr)",
  "--ep-footer-progress-gap": "0px",
  "--ep-footer-progress-times-display": "none",
  "--ep-footer-top-time-display": "block",
  "--ep-footer-unplayed-color": "transparent",
  "--ep-footer-show-unplayed": "0"
}
```

公共类：`.ep-footer-info`、`.ep-footer-playback`、`.ep-footer-transport`、`.ep-footer-progress`、`.ep-footer-actions`、`.ep-footer-toggle`。

## 样式维护约定

简单布局、间距、排版与响应式状态直接使用 Tailwind；共享材料、复杂状态和伪元素放到公共 CSS。新的可定制组件提供 `ep-*` 类和语义变量，避免复制浅色/深色硬编码。主题文件只保存覆写，切换时整体移除，防止前一个主题残留。
