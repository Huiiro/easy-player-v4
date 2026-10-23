# 主题变量参考

基础控件新增尺寸与反馈接口见 [UI 组件规范](player/ui-component-refactor.md)：
`--ep-control-height-xs/sm/md/lg`（默认 24/28/32/40px）、`--ep-control-radius`（6px）、
`--ep-disabled-opacity`（0.5）、`--ep-floating-radius`（12px）、
`--ep-z-floating`（50）、`--ep-z-message`（9999）、`--ep-skeleton-bg`、`--ep-switch-thumb`。
原有按钮、进度、弹窗和主题包接口继续兼容。

适用主题格式 `version: 1`。变量写入主题 JSON 的 `tokens`，值全部使用字符串。语法、覆盖顺序及公开类见 [开发规范](custom-themes.md)，字体与图片见 [资源包规范](theme-packages.md)。

表中为代码内默认值或 `var()` 回退值，不代表所有运行状态的最终 computed style。浅色 / 深色指内置普通模式；内置动态背景、歌曲主题色、用户设置可能另有调整。省略的变量继续跟随应用。组合一个配色主题时，至少一起检查文字、表面、边框、悬停与强调色的对比度。

## 全局颜色

这些变量作用于消费它们的 Tailwind 工具类和组件公共样式，不会自动改写所有手写颜色。除特别标注外，值类型为 CSS `<color>`，不能填渐变；渐变使用支持背景类型的变量。`--color-primary` 等已通过 `@property` 注册为颜色的变量，还会受到浏览器的类型校验。

### 强调色与固定色

| 变量                                                                           | 默认值                                                      | 含义 / 范围                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `--color-primary`                                                              | `oklch(0.691 0.198 148.262)`                                | 全局强调色；未覆写时可由用户色彩设置或歌曲主题色更新         |
| `--color-primary-l-10`                                                         | `color-mix(in srgb, var(--color-primary), #fff 10%)`        | 强调色混白 10%                                               |
| `--color-primary-l-20`                                                         | `color-mix(in srgb, var(--color-primary), #fff 20%)`        | 混白 20%，主按钮悬停默认引用                                 |
| `--color-primary-l-50`                                                         | `color-mix(in srgb, var(--color-primary), #fff 50%)`        | 混白 50%                                                     |
| `--color-primary-l-75`                                                         | `color-mix(in srgb, var(--color-primary), #fff 75%)`        | 混白 75%                                                     |
| `--color-primary-d-10`                                                         | `color-mix(in srgb, var(--color-primary), transparent 10%)` | 强调色混透明 10%                                             |
| `--color-primary-d-20`                                                         | `color-mix(in srgb, var(--color-primary), transparent 20%)` | 混透明 20%                                                   |
| `--color-primary-d-50`                                                         | `color-mix(in srgb, var(--color-primary), transparent 50%)` | 混透明 50%                                                   |
| `--color-primary-d-75`                                                         | `color-mix(in srgb, var(--color-primary), transparent 75%)` | 混透明 75%                                                   |
| `--color-primary-fill`                                                         | `var(--color-primary)`                                      | 强调填充；底层歌曲主题可能提供独立填充色，消费位置按背景使用 |
| `--color-on-primary`                                                           | `var(--color-white)`                                        | 强调背景上的前景色，部分内置背景/按钮使用                    |
| `--color-black-10`、`--color-black-20`、`--color-black-40`、`--color-black-50` | 黑色，分别 10% / 20% / 40% / 50% 不透明度                   | 固定黑色透明层                                               |
| `--color-white`                                                                | `rgb(255 255 255)`                                          | 固定白色                                                     |
| `--color-white-90`                                                             | `color-mix(in srgb, #fff, transparent 10%)`                 | 白色 90% 不透明度                                            |

`primary-d-*` 名称中的 `d` 在当前实现中表示混透明，**不是混黑变暗**。修改 `primary` 通常会带动未被单独覆写的派生色；将派生色写死后，它们不再跟随主色变化。`--color-primary-fill` 可用于支持背景的填充位置，但不应假定所有间接引用它的颜色属性都支持渐变。

### 文字、表面、边框与图标

| 变量               | 浅色默认                     | 深色默认                     | 用途                             |
| ------------------ | ---------------------------- | ---------------------------- | -------------------------------- |
| `--color-text`     | `oklch(21% 0.034 264.665)`   | `oklch(92% 0.01 260)`        | 主文字                           |
| `--color-text-l`   | `oklch(45% 0.02 260)`        | `oklch(70% 0.02 260)`        | 次级文字                         |
| `--color-text-l2`  | `oklch(36% 0.01 260)`        | `oklch(55% 0.015 260)`       | 辅助文字；后缀不表示严格亮度顺序 |
| `--color-text-l3`  | `oklch(87.2% 0.01 258.338)`  | `oklch(35% 0.01 260)`        | 对比或弱化文字，需按实际组件检查 |
| `--color-bg`       | `oklch(98.5% 0.001 106.423)` | `oklch(14% 0.01 260)`        | 主表面及组件背景回退             |
| `--color-bg-l`     | `oklch(95% 0.01 110)`        | `oklch(18% 0.015 260)`       | 卡片、菜单等表面                 |
| `--color-bg-l2`    | `oklch(96% 0.005 110)`       | `oklch(22% 0.02 260)`        | 次层表面、次按钮                 |
| `--color-bg-d`     | `oklch(55.1% 0.027 264.364)` | `oklch(10% 0.01 260)`        | 特殊深表面                       |
| `--color-border`   | `oklch(0.678 0.009 253.88)`  | `oklch(0.306 0.005 286.081)` | 常规边框、滑块轨道回退           |
| `--color-border-l` | `oklch(0.778 0.011 196.927)` | `oklch(0.532 0.002 286.347)` | 辅助边框                         |
| `--color-icon`     | `oklch(30% 0.03 260)`        | `oklch(80% 0.01 260)`        | 图标                             |
| `--color-icon-l`   | `oklch(70% 0.01 260)`        | `oklch(55% 0.01 260)`        | 辅助图标                         |

### 状态与交互

| 变量                     | 浅色默认              | 深色默认                    | 用途                       |
| ------------------------ | --------------------- | --------------------------- | -------------------------- |
| `--color-danger`         | `oklch(55% 0.22 25)`  | `oklch(65% 0.2 25)`         | 危险状态                   |
| `--color-success`        | `oklch(65% 0.18 145)` | `oklch(70% 0.18 145)`       | 成功状态                   |
| `--color-warning`        | `oklch(75% 0.16 80)`  | `oklch(80% 0.16 80)`        | 警告状态                   |
| `--color-border-danger`  | `oklch(60% 0.22 25)`  | `oklch(60% 0.2 25)`         | 危险边框                   |
| `--color-border-success` | `oklch(65% 0.18 145)` | 同浅色                      | 成功边框                   |
| `--color-border-warning` | `oklch(75% 0.16 80)`  | 同浅色                      | 警告边框                   |
| `--color-hover`          | `rgba(0, 0, 0, 0.05)` | `rgba(255, 255, 255, 0.06)` | 侧栏等悬停叠加层           |
| `--color-hover-bg`       | `oklch(92% 0.01 110)` | `oklch(25% 0.02 260)`       | 次按钮、幽灵按钮等悬停背景 |
| `--color-hover-danger`   | `oklch(92% 0.03 25)`  | `oklch(30% 0.05 25)`        | 危险项悬停背景             |
| `--color-hover-t-10`     | 黑色 3%               | 白色 4%                     | 透明交互层                 |
| `--color-hover-t-20`     | 黑色 6%               | 白色 8%                     | 透明交互层                 |
| `--color-hover-t-30`     | 黑色 10%              | 白色 12%                    | 透明交互层                 |
| `--color-hover-t-40`     | 黑色 15%              | 白色 16%                    | 透明交互层                 |
| `--color-hover-t-50`     | 黑色 20%              | 白色 22%                    | 透明交互层                 |

状态边框和危险按钮有独立变量，不会因为只修改 `--color-danger` 就全部同步。

## 按钮、滚动条与组件材料

### 按钮与滚动条

| 变量                      | 默认值                                                              | 作用范围 / 类型                            |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `--btn-primary-bg`        | `var(--color-primary-fill)`                                         | 主按钮背景，CSS background                 |
| `--btn-primary-text`      | `var(--color-white)`                                                | 主按钮文字，颜色；部分内置背景另有默认引用 |
| `--btn-primary-bg-hover`  | `var(--color-primary-l-20)`                                         | 主按钮悬停背景                             |
| `--btn-primary-ring`      | `var(--color-primary)`                                              | 主按钮焦点环，颜色                         |
| `--btn-danger-bg`         | `#fee2e2`                                                           | 危险按钮背景                               |
| `--btn-danger-bg-hover`   | `#fecaca`                                                           | 危险按钮悬停背景                           |
| `--btn-danger-text`       | `#7f1d1d`                                                           | 危险按钮文字，颜色                         |
| `--btn-danger-ring`       | `#7f1d1d`                                                           | 危险按钮焦点环，颜色                       |
| `--scrollbar-track`       | `transparent`                                                       | 主文档使用公共样式的滚动轨道，颜色         |
| `--scrollbar-thumb`       | 浅色 `oklch(92.3% 0.003 48.717)`；深色 `oklch(0.228 0.031 256.878)` | 滚动滑块                                   |
| `--scrollbar-thumb-hover` | 浅色 `oklch(86.9% 0.005 56.366)`；深色 `oklch(0.402 0.025 257.521)` | 滚动滑块悬停                               |

### 框架、侧栏、弹层与开关

| 变量                       | 默认值 / 回退                                                          | 作用范围 / 类型                                   |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `--ep-app-bg`              | `var(--color-bg)`                                                      | 接管主界面背景时的 background；支持渐变           |
| `--app-header-bg`          | `color-mix(in srgb, var(--color-bg) 82%, transparent)`                 | 顶栏背景；已注册 `<color>`，使用颜色，不填渐变    |
| `--app-footer-bg`          | `color-mix(in srgb, var(--color-bg) 78%, transparent)`                 | 底栏背景；已注册 `<color>`，使用颜色，不填渐变    |
| `--app-chrome-border`      | 顶栏混入 `--color-border` 82%；底栏混入 `--color-text` 10%，余下为透明 | 顶/底栏边框，颜色；设置一个值会同时影响两处       |
| `--ep-button-radius`       | `0.375rem`                                                             | BaseButton 圆角，CSS border-radius                |
| `--ep-sidebar-bg`          | `transparent`                                                          | 侧栏 background；支持渐变                         |
| `--ep-sidebar-text`        | `var(--color-text-l)`                                                  | 导航项文字颜色                                    |
| `--ep-sidebar-active-bg`   | `color-mix(in srgb, var(--color-primary) 15%, transparent)`            | 活动导航项背景                                    |
| `--ep-sidebar-active-text` | `var(--color-primary)`                                                 | 活动导航项文字颜色                                |
| `--ep-sidebar-item-radius` | `0.5rem`                                                               | 导航项圆角                                        |
| `--ep-dialog-bg`           | `var(--color-bg)`                                                      | BaseDialog 与 BaseDrawer 面板背景                 |
| `--ep-dialog-radius`       | `1rem`                                                                 | BaseDialog 圆角；不自动控制抽屉圆角               |
| `--ep-overlay-bg`          | `rgb(0 0 0 / 50%)`                                                     | 对话框/抽屉遮罩 background                        |
| `--ep-surface-shadow`      | `0 20px 25px -5px rgb(0 0 0 / 10%), 0 8px 10px -6px rgb(0 0 0 / 10%)`  | 对话框/抽屉阴影，CSS box-shadow                   |
| `--ep-switch-active`       | `var(--color-primary)`                                                 | 开启时背景颜色；显式 `activeColor` 组件属性优先   |
| `--ep-switch-inactive`     | `var(--color-border)`                                                  | 关闭时背景颜色；显式 `inactiveColor` 组件属性优先 |

顶/底栏的背景回退还可能由运行时外观逻辑写入。要给已注册为 `<color>` 的区域添加渐变，使用 `.ep-header` / `.ep-footer` 的普通背景规则；添加图片使用清单。不要用颜色变量塞入 `url()`。

## 进度条与滑块

`BaseSlider` 使用独立轨道/填充/滑块节点，`BaseRange` 使用原生 `input[type=range]` 及内部伪元素。播放进度带 `.ep-playback-progress`，音量等其他原生滑块也可能带 `.ep-range`；range 变量默认影响所有消费这些变量的 range。

| 变量                         | 默认值 / 回退                                                       | 作用范围 / 类型                                                         |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `--ep-progress-track`        | `var(--color-border)`                                               | BaseSlider 轨道，以及 BaseRange 未播放颜色的回退；给出颜色可兼容两者    |
| `--ep-progress-fill`         | `var(--color-primary)`                                              | BaseSlider 填充、BaseRange 填充及滑块颜色回退；建议颜色                 |
| `--ep-progress-thumb`        | `var(--color-bg)`                                                   | 只控制 BaseSlider 滑块背景                                              |
| `--ep-range-track-height`    | `0.25rem`                                                           | BaseRange 轨道高度，长度                                                |
| `--ep-range-thumb-width`     | `1rem`                                                              | BaseRange 滑块宽度，长度                                                |
| `--ep-range-thumb-height`    | `1rem`                                                              | BaseRange 滑块高度，长度                                                |
| `--ep-range-thumb-radius`    | `999px`                                                             | BaseRange 滑块圆角                                                      |
| `--ep-range-thumb-bg`        | `var(--ep-progress-fill)`                                           | BaseRange 滑块底色/背景                                                 |
| `--ep-range-thumb-image`     | `none`                                                              | 图片入口；由清单 `playbackThumb` 生成局部内部 URL，不在 JSON 中手写 URL |
| `--ep-range-fill-background` | `linear-gradient(var(--ep-progress-fill), var(--ep-progress-fill))` | BaseRange 已播放部分背景，允许渐变                                      |
| `--ep-range-unplayed-color`  | `var(--ep-progress-track)`                                          | BaseRange 未播放部分，颜色；底栏有局部定义，改用下文底栏变量            |
| `--ep-range-show-unplayed`   | `1`                                                                 | 数字 `1` 显示未播放部分，`0` 隐藏；底栏有局部定义                       |

要区分已播与未播颜色，应同时考虑 `--ep-progress-fill` 和 `--ep-progress-track`。底栏顶部模式有意只画已播部分，不应通过伪元素规则给整条轨道刷同一个背景。图片滑块采用居中、contain、无重复与像素化渲染；尺寸过大会遮住时间或操作按钮，应检查窄窗口。

下面两个变量是**内部运行时状态**，虽符合前缀规则，也不要放入主题：

| 内部变量                  | 作用                                                     |
| ------------------------- | -------------------------------------------------------- |
| `--ep-range-progress`     | BaseRange 内联更新的归一化进度 `0..1`；控制填充终点      |
| `--ep-range-has-progress` | BaseRange 内联更新的 `0` / `1`；用于零进度时隐藏顶部填充 |

## 底栏布局变量

作用于展开底栏及其子区域，默认对称五列、中央播放区占 `2.2fr`、最大宽度 1320px。值必须是对应 CSS 属性可用的字符串。用户开启自定义底栏布局后，下列布局变量由底栏元素的局部内联声明控制；关闭后才能完整跟随主题。

| 变量                                 | 默认值 / 回退                                                  | 作用                                          |
| ------------------------------------ | -------------------------------------------------------------- | --------------------------------------------- |
| `--ep-footer-max-width`              | `1320px`                                                       | 最大宽度                                      |
| `--ep-footer-gap`                    | `20px`                                                         | 主区域间距；用户布局也使用默认 20px           |
| `--ep-footer-columns`                | `32px minmax(0, 1fr) minmax(180px, 2.2fr) minmax(0, 1fr) 32px` | 主网格列定义                                  |
| `--ep-footer-areas`                  | `'info info playback actions toggle'`                          | 主网格区域排列，必须包含引号                  |
| `--ep-footer-playback-display`       | `grid`                                                         | 播放区布局；顶部模式通常为 `contents`         |
| `--ep-footer-transport-area`         | `auto`                                                         | 播放按钮组网格区域；顶部模式为 `transport`    |
| `--ep-footer-top-time-display`       | `none`                                                         | 按钮右侧时间显示；顶部模式为 `block`          |
| `--ep-footer-progress-columns`       | `3.5rem minmax(0, 1fr) 3.5rem`                                 | 时间/进度/时间三列                            |
| `--ep-footer-progress-area`          | `auto`                                                         | 进度容器网格区域                              |
| `--ep-footer-progress-position`      | `static`                                                       | 进度容器定位方式；顶部模式为 `absolute`       |
| `--ep-footer-progress-inset`         | `auto`                                                         | 进度容器边距；顶部模式通常 `0 24px auto`      |
| `--ep-footer-progress-transform`     | `none`                                                         | 进度容器变换；顶部模式通常 `translateY(-50%)` |
| `--ep-footer-progress-gap`           | `8px`                                                          | 时间与轨道间距；顶部模式为 `0px`              |
| `--ep-footer-progress-times-display` | `block`                                                        | 轨道两侧时间显示；顶部模式为 `none`           |
| `--ep-footer-unplayed-color`         | `var(--ep-progress-track)`                                     | 底栏未播放颜色；顶部模式为 `transparent`      |
| `--ep-footer-show-unplayed`          | `1`                                                            | 底栏显示未播放轨道；顶部模式为 `0`            |

响应式规则会直接设置布局属性及局部 range 变量：窗口宽度 ≤980px 强制采用顶部进度线，≤640px 隐藏总时长。此时修改根级布局变量不一定能改变最终布局。歌曲信息与操作区宽度还依赖运行时测量；不要覆写测量状态。

### 顶部进度线完整示例

JSON 的双引号转义发生在解析阶段，下面 `areas` 的实际 CSS 值是带引号的网格区域字符串，不含反斜杠。这是合法值。

```json
{
  "version": 1,
  "name": "Top Progress Layout",
  "background": "inherit",
  "tokens": {
    "--ep-footer-max-width": "1400px",
    "--ep-footer-areas": "\"info info transport actions toggle\"",
    "--ep-footer-playback-display": "contents",
    "--ep-footer-transport-area": "transport",
    "--ep-footer-progress-position": "absolute",
    "--ep-footer-progress-inset": "0 24px auto",
    "--ep-footer-progress-transform": "translateY(-50%)",
    "--ep-footer-progress-columns": "minmax(0, 1fr)",
    "--ep-footer-progress-gap": "0px",
    "--ep-footer-progress-times-display": "none",
    "--ep-footer-top-time-display": "block",
    "--ep-footer-unplayed-color": "transparent",
    "--ep-footer-show-unplayed": "0"
  }
}
```

## 歌词变量

主要作用于**主窗口播放器歌词组件**，不自动传入独立的桌面歌词窗口。

| 变量                   | 默认值                        | 类型 / 作用          |
| ---------------------- | ----------------------------- | -------------------- |
| `--lrc-default`        | `oklch(70.7% 0.022 261.325)`  | 未高亮歌词颜色       |
| `--lrc-highlight`      | `#ffffff`                     | 当前歌词颜色         |
| `--lrc-translate`      | `oklch(87.2% 0.01 258.338)`   | 翻译颜色             |
| `--lrc-size`           | `2.4rem`                      | 主歌词字号，长度     |
| `--lrc-translate-size` | `calc(var(--lrc-size) * 0.6)` | 翻译字号，长度       |
| `--lrc-height`         | `1.6`                         | 行高，建议无单位数字 |
| `--lrc-padding`        | `30px`                        | 歌词纵向留白，长度   |

播放器会根据背景使用局部歌词颜色和 `.player-lyrics--dark-text`，组件颜色属性也可生成局部声明；这些优先于继承来的根级色值。因此根级 `--lrc-*` 并不保证覆盖播放器全部状态。用户字号、留白设置若写在同一根元素上，则主题根级 `!important` 会胜过普通内联变量；固定这些值前应考虑用户可读性需求。

## 动效变量

作用于引用它们的主题过渡、公共控件与 Vue 过渡。不覆盖所有独立背景动画、视频或着色器时间线。

| 变量                           | 默认值                              | 类型 / 用途            |
| ------------------------------ | ----------------------------------- | ---------------------- |
| `--motion-duration-fast`       | `150ms`                             | 时间，快速反馈         |
| `--motion-duration-standard`   | `200ms`                             | 时间，普通交互         |
| `--motion-duration-slow`       | `300ms`                             | 时间，较慢过渡         |
| `--motion-duration-emphasized` | `400ms`                             | 时间，强调过渡         |
| `--motion-duration-theme`      | `220ms`                             | 时间，主题色与材料过渡 |
| `--motion-ease-standard`       | `cubic-bezier(0.2, 0, 0, 1)`        | CSS easing             |
| `--motion-ease-enter`          | `cubic-bezier(0, 0, 0.2, 1)`        | 进入 easing            |
| `--motion-ease-exit`           | `cubic-bezier(0.4, 0, 1, 1)`        | 离开 easing            |
| `--motion-ease-emphasized`     | `cubic-bezier(0.22, 1, 0.36, 1)`    | 强调 easing            |
| `--motion-ease-spring`         | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性 easing            |

系统 `prefers-reduced-motion` 和应用减少动态效果设置会通过专门规则关闭过渡/动画，不应依赖主题时长绕过这些规则。

## 不属于公开变量的内容

- `--el-dialog-bg-color`、`--el-dialog-title-color` 是历史命名，前缀不在导入白名单，当前 BaseDialog 应使用 `--ep-dialog-*`。
- `--tw-*`、`--default-transition-duration`、`--default-transition-timing-function` 属于 Tailwind 或内部映射，不接受主题导入。
- 底栏测量宽度、播放进度、拖动坐标等属于运行状态，不是外观配置。
- 任意新 `--ep-*` 名称通过语法检查，不表示已成为支持接口；以本文和实际组件消费为准。

查证默认值：[theme.css](../src/renderer/src/styles/theme.css)、[components.css](../src/renderer/src/styles/components.css)、[motion.css](../src/renderer/src/styles/motion.css)。新增变量时请同步此表、作用范围与覆盖限制。
