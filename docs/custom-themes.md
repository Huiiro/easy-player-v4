# 自定义主题开发规范

本文对应主题格式 `version: 1`，面向主题作者与样式维护者。完整属性见 [主题变量参考](theme-variables.md)，图片、字体与文字清单见 [资源包规范](theme-packages.md) 和 [manifest JSON Schema](themes/manifest.schema.json)。

## 入口与发布形式

入口：**设置 → 主题 → 自定义主题**。

| 形式          | 内容                                          | 适合用途                   |
| ------------- | --------------------------------------------- | -------------------------- |
| `.theme.json` | 变量与组件规则                                | 配色、圆角、进度条、布局   |
| `.theme.zip`  | 根目录 `manifest.json`、主题 JSON、声明的资源 | 图片、字体、指定位置的文字 |

`.theme` 是推荐命名约定；实际导入支持 JSON、ZIP。主题是声明式样式，不能执行 JavaScript，也不是可安装代码的插件接口。

## 最小可用主题

保存为 `ocean.theme.json` 后导入。示例同时设置文字和表面颜色，避免深色背景搭配浅色模式的深色文字。

```json
{
  "version": 1,
  "name": "Ocean Glass",
  "background": "replace",
  "tokens": {
    "--color-primary": "#38bdf8",
    "--color-text": "#e7f3ff",
    "--color-text-l": "#b8cede",
    "--color-text-l2": "#91aabb",
    "--color-bg": "#102536",
    "--color-bg-l": "#183247",
    "--color-bg-l2": "#203c51",
    "--color-border": "#476078",
    "--color-hover": "rgb(56 189 248 / 12%)",
    "--color-hover-bg": "#25465f",
    "--ep-app-bg": "linear-gradient(135deg, #102536, #151121)",
    "--ep-sidebar-active-bg": "rgb(56 189 248 / 20%)",
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

更多可导入示例：[Neon JSON](themes/neon-test.theme.json)、[资源包](themes/resource-demo.theme.zip)、[图片进度滑块主题](themes/nyan-cat.theme.zip)。示例资源的再发布须遵守其许可。

## JSON 字段与校验

| 字段         | 类型 / 默认                           | 约束与作用                                                                      |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------- |
| `version`    | 数字，必填                            | 当前只能是 `1`                                                                  |
| `name`       | 字符串，必填                          | 不能全为空白；原始长度最多 80，保存时去掉首尾空白；名称区分大小写，同名导入替换 |
| `background` | `replace` / `inherit`，默认 `replace` | 是否接管主界面背景，见下文                                                      |
| `tokens`     | 字符串键值对象，默认 `{}`             | 覆写根级 CSS 自定义属性；值均为字符串                                           |
| `rules`      | 选择器到属性对象的映射，默认 `{}`     | 调整公开组件类；CSS 属性和值均为字符串                                          |
| `package`    | 内部安装信息                          | 由 ZIP 导入流程生成；作者不要填写或复制安装 ID、资源 URL                        |

JSON 不支持注释、尾逗号或原始 CSS 文本。文件最多 **128 KiB（UTF-8 字节数）**；最多保存 20 个主题，同名替换不新增名额。ZIP 中主题与清单各有文件上限，安装时合并后的主题声明仍受 128 KiB 限制，需为清单留出空间。

变量名只接受 `--color-`、`--btn-`、`--scrollbar-`、`--app-`、`--ep-`、`--lrc-`、`--motion-` 前缀，后续只能是小写英文字母、数字和连字符。优先使用 [已有变量](theme-variables.md)；符合前缀的未知名称也可能通过校验，但没有消费它的组件就不会产生效果。

变量与规则值必须非空，长度最多 500。长度限制按 JavaScript 字符串长度计数。禁止分号、花括号、尖括号、`@`、反斜杠、`!`、控制字符、CSS 注释起始符，以及 `url()`、`image-set()`、`expression()`。不能使用 `!important`、`@import`、外部 URL、内嵌 data URL 或 CSS 转义。图片和字体必须走资源包清单。

`rules` 会额外用当前 Chromium 的 `CSS.supports(property, value)` 校验；`tokens` 不做逐项 CSS 类型验证。主题能导入不代表每个变量值都能被组件正确使用，例如颜色变量应提供颜色，尺寸应带适当单位。

## 背景与作用范围

- `replace`：隐藏原有内置、图片、视频或动态背景，使用主题的 `.ep-app-background`；其默认背景是 `--ep-app-bg`，回退到 `--color-bg`。支持纯色、渐变和清单 `appBackground` 图片。
- `inherit`：保留用户原有背景，主题仍可调整控件配色与其他区域。此时不要依赖 `.ep-app-background` 或 `appBackground` 槽位显示图片。
- 省略 `background` 等同于 `replace`。原背景偏好仍保留，停用主题后恢复。

主题样式注入**主渲染文档**。主页、侧栏、顶栏、底栏以及同一文档内传送到 `body` 的菜单、对话框都在覆盖范围内。播放器详情页使用自己的背景与部分自动对比色，不等于主页背景；详见歌词变量的局部限制。

迷你播放器、桌面歌词等独立窗口有各自文档，不会自动收到主窗口的主题样式与包字体。操作系统窗口边框、文件选择框等原生界面也不属于这些 CSS 的作用范围。导入确认框使用固定样式与浏览器顶层对话框，不提供主题覆写入口。

主题不会设置 `.dark` 类、系统深浅色或用户字体偏好。当前格式只提供一套声明，不支持 `@media` 或按深浅色分别声明规则；未覆写的变量仍跟随底层模式，发布前要检查混用效果。

## 样式优先级与继承

主题生成顺序是：根级 `tokens` → 清单图片/字体规则 → 作者 `rules`。切换时整体替换样式表，防止旧规则残留。

1. `tokens` 注入 `:root` 并由加载器添加 `!important`，覆盖同一根元素上的内置普通声明和普通内联变量。作者不用也不能手写 `!important`。
2. **根级变量通过继承传播；后代元素自己定义的同名变量会优先于继承值。** 根级 `!important` 不会跨元素压过后代声明。例如底栏有自己的 `--ep-range-unplayed-color`，应改公开的 `--ep-footer-unplayed-color`。
3. `rules` 是普通 CSS，仍受选择器优先级、内联样式及组件局部规则影响。不要将“在后面加载”等同于必定覆盖。运行时位置、尺寸和用户设置优先使用专用变量接口。
4. 同等优先级下，作者规则在清单生成规则后生效。`background` 简写会清除清单设置的 `background-image`；只调整底色时使用 `background-color`。
5. 区域字体会明确设置区域及其中表单控件的字体，优先于清单全局字体。主布局中用户显式选择的字体可能覆盖从全局继承的字体；局部字体或组件自己指定的字体仍遵循普通 CSS 继承与优先级。

用户开启“自定义底栏布局”时，会在底栏元素上写入局部布局变量，因此优先于主题根级布局变量；关闭或恢复默认后继续使用主题。歌词局部色彩、开关显式颜色属性也有各自的覆盖规则，见变量参考。

## 规则语法

支持单个 `.ep-*` 类，以及用**单个空格**连接的后代类；每段类可带一个 `:hover`、`:focus-visible` 或 `:disabled`。例如下面是完整可导入的规则主题：

```json
{
  "version": 1,
  "name": "Rounded Controls",
  "background": "inherit",
  "rules": {
    ".ep-button": { "border-radius": "12px" },
    ".ep-button:focus-visible": { "outline": "2px solid var(--color-primary)" },
    ".ep-sidebar .ep-sidebar-item:hover": { "filter": "brightness(1.1)" },
    ".ep-dialog-panel": { "background-color": "var(--color-bg-l)" }
  }
}
```

不接受选择器列表、标签、ID、属性选择器、复合类、通配符、`>` / `+` / `~`、`:root`、`.dark`、伪元素、其他伪类或 at-rule。因此不能直接选中原生 range 的滑块伪元素，应使用 `--ep-range-*` 变量。

属性名采用小写 CSS 连字符写法，如 `border-radius`，不能写 `borderRadius`。不能在 `rules` 中声明 `--xxx` 自定义属性，变量统一放 `tokens`。未知但语法有效的 `.ep-*` 类不会报错，实际有对应节点才有效。不要依赖 Vue scoped 属性、Tailwind 生成的类名或未公开内部 DOM。

## 公开组件类

| 区域             | 可覆写类                                                                                                          | 覆盖范围与注意事项                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 主界面背景、首页 | `.ep-app-background`、`.ep-home`                                                                                  | 背景层与首页内容容器是两个区域                          |
| 窗口框架         | `.ep-header`、`.ep-footer`                                                                                        | 顶栏、底部播放栏                                        |
| 侧边栏           | `.ep-sidebar`、`.ep-sidebar-item`、`.ep-sidebar-item--active`                                                     | 容器、导航项、当前导航项                                |
| 按钮             | `.ep-button`、`.ep-button--primary`、`.ep-button--secondary`、`.ep-button--ghost`、`.ep-button--danger`           | BaseButton；不保证覆盖手写播放控制按钮或所有原生 button |
| 输入、选择       | `.ep-input`、`.ep-select`、`.ep-select-options`                                                                   | BaseInput 实际输入元素、选择触发器、下拉面板            |
| 开关             | `.ep-switch`、`.ep-switch-thumb`                                                                                  | 开关容器与滑块；尺寸可能由组件内联设置                  |
| 自绘滑块         | `.ep-slider`、`.ep-progress-track`、`.ep-progress-fill`、`.ep-progress-thumb`                                     | BaseSlider 容器与轨道、填充、滑块 DOM                   |
| 原生滑块         | `.ep-range`、`.ep-playback-progress`                                                                              | BaseRange；后者标记底栏及播放器详情的播放进度 input     |
| 对话框           | `.ep-dialog`、`.ep-dialog-panel`、`.ep-dialog-header`、`.ep-dialog-title`、`.ep-dialog-body`、`.ep-dialog-footer` | BaseDialog 根节点、面板及内容分区                       |
| 抽屉             | `.ep-drawer`、`.ep-drawer-panel`、`.ep-drawer-header`、`.ep-drawer-body`、`.ep-drawer-footer`                     | BaseDrawer 根节点、面板及内容分区                       |
| 遮罩             | `.ep-overlay`                                                                                                     | BaseDialog、BaseDrawer 共用遮罩                         |
| 菜单、浮层       | `.ep-menu`、`.ep-popover`                                                                                         | BaseMenu、底栏菜单、BasePopover                         |

组件分区按实际插槽与状态渲染；主题不能创建不存在的标题或页脚。菜单、对话框可能 Teleport 到 `body`：全局 `.ep-menu` 可命中，但 `.ep-sidebar .ep-menu` 不能命中已移出侧栏的节点。旧 `.input-base` 虽复用输入材料，但不属于主题规则允许的类名。

### 底栏子区域

| 公开类                                                                                                         | 用途                               |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `.ep-footer-info`                                                                                              | 歌曲信息区                         |
| `.ep-footer-playback`                                                                                          | 播放控制与进度区                   |
| `.ep-footer-transport`、`.ep-footer-transport-buttons`                                                         | 播放控制区、按钮组                 |
| `.ep-footer-progress`                                                                                          | 时间与进度条容器                   |
| `.ep-footer-top-time`、`.ep-footer-total-time`                                                                 | 顶部模式时间、总时长               |
| `.ep-footer-actions`、`.ep-footer-toggle`                                                                      | 右侧操作区、展开/收起入口          |
| `.ep-footer-action-secondary`、`.ep-footer-action-mode`、`.ep-footer-action-queue`、`.ep-footer-action-volume` | 常规操作、播放模式、队列、音量入口 |
| `.ep-footer-menu-secondary`、`.ep-footer-menu-mode`、`.ep-footer-menu-queue`、`.ep-footer-menu-volume`         | 上述功能收进更多菜单后的对应入口   |

布局变量主要面向**展开的底栏**。用户布局设置和响应式规则有优先权：窗口宽度不大于 980px 时采用顶部进度线；不大于 640px 时隐藏总时长。右侧容器小于 272 / 152 / 112 / 72px 时，依次收起次要操作 / 播放模式 / 队列 / 音量到更多菜单。不要用主题强制显示这些已收起按钮，避免溢出。

播放进度与音量等滑块并非同一组件。`--ep-progress-*` 是共享配色；`--ep-range-*` 调整原生 input，`--ep-progress-thumb` 只控制 BaseSlider 的滑块。底栏未播放部分使用 `--ep-footer-unplayed-color`，顶部模式会隐藏它。设置图片滑块使用清单 `playbackThumb`，不要覆写运行时进度变量。完整布局变量及顶部进度线示例见 [变量参考](theme-variables.md#底栏布局变量)。

## 导入、保存与卸载

只有导入 JSON 或 ZIP（包括同名重新导入）时进入 **10 秒预览确认**。确认后保存主题及选择；取消、Escape 或超时恢复上一个主题，未确认的导入不会在重启后自动启用。

同名主题在确认前保留旧声明和旧资源，确认后才替换；取消时清理本次新资源。已安装主题的后续切换，以及选择默认、浅色、深色、内置或自定义背景，均立即生效，无需确认或倒计时。

“默认（不覆写）”表示停用自定义主题并回到当前内置外观，不表示强制浅色。重置外观会停用覆写，保留已安装主题供后续选择。主题声明随 UI 偏好存储，资源复制到应用数据目录；移动原导入文件不影响使用。导出仅含主题声明及清单声明的文件，不包含整套用户设置或机器绝对路径。

第三方主题可能遮挡内容、影响阅读或消耗资源。导入限制、资源白名单和预览恢复降低风险，不构成对资源解码器或视觉欺骗的全面安全保证。不要通过主题承载脚本；资源规则详见 [资源包规范](theme-packages.md#安全边界)。

## 开发与验收

1. 从少量语义变量开始，先保证文字、背景、边框、悬停和禁用态可读，再添加区域规则。优先复用已有变量，避免对每个组件重复写颜色。
2. 检查底层浅色、深色、动态背景，主页与播放器详情，按钮各变体、输入焦点、选择下拉、菜单、对话框和抽屉。
3. 检查大窗口、980px/640px 附近、底栏收起状态和右侧按钮溢出；分别测试用户底栏布局开关。
4. 包字体应覆盖中文、英文、数字、标点；缺字会逐字回退。用实际文字与字形确认，不仅检查 computed font-family。分别测试用户指定字体及区域字体；导出后换一份安装目录验证路径独立性。
5. 检查首页欢迎语优先级：用户非空内容 → 主题内容 → 默认问候语。主题不得改写已保存的用户文本。
6. 测试首次导入、同名替换、确认、取消、Escape、10 秒超时、已安装主题切换、默认、重启恢复、导出再导入与删除。

仓库内的解析与资源回归检查可在项目根目录运行：

```sh
node scripts/test-custom-theme.mjs
node scripts/test-theme-package.mjs
node scripts/test-theme-preview.mjs
```

这些脚本不替代实际界面检查。修改实现后再运行 `npm run typecheck` 等对应检查。遇到“修改无效”，先确认应用连接的开发服务器和源代码目录一致，再检查导入错误、公开类是否实际存在、变量消费位置及局部内联样式。

## 项目样式维护约定

- 简单布局、间距、排版和响应式状态使用 Tailwind；共享材料、复杂状态、伪元素样式抽到公共 CSS，避免组件重复复制颜色。
- 可定制组件应提供稳定 `.ep-*` 类和有默认值的语义变量。布局优先提供变量接口，不要求作者依赖内部 DOM、运行时测量值或 Tailwind 类。
- 默认值优先引用已有 `--color-*` 等变量，使未覆写区域跟随全局样式；在组件上声明局部变量前评估是否会挡住根级主题继承。
- 新增资源位置时同步 `THEME_SLOTS`、manifest Schema、校验、用例和这组文档；安全恢复 UI 不加入可覆写类。
- 保持旧主题默认行为与回退。未知变量/类可能静默无效，未知清单槽位则导入失败；新增槽位的主题需告知适用应用版本。当前没有 `minAppVersion` 自动兼容检查，不要将自行添加的字段当作版本保护。

实现入口：[主题解析与注入](../src/renderer/src/services/customTheme.ts)、[全局配色](../src/renderer/src/styles/theme.css)、[公共组件材料](../src/renderer/src/styles/components.css)、[动效](../src/renderer/src/styles/motion.css)、[资源槽位与清单校验](../src/shared/themePackage.ts)、[主进程资源导入](../src/main/service/themePackageService.ts)。
