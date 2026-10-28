# 第三方主题适配指南

适用于当前 `.epp` 主题插件：SDK **2.1**、插件 API **2**、主题数据格式 **1**。安装入口为「设置 → 插件 → 导入本地包」，启用后到外观设置中选择背景。安装不会自动切换外观，也不触发旧主题的 10 秒预览。

完整打包、容量和着色器协议见插件仓库的 [THEMES.md](https://github.com/Huiiro/easy-player-plugin/blob/master/THEMES.md)。本页说明当前宿主的配色、作用范围和验收要求；公开接口以 [主题变量参考](theme-variables.md)、[SDK 类型](../packages/plugin-sdk/src/themes.ts) 和 [Schema](../packages/plugin-sdk/schemas/theme.schema.json) 为准。

旧 `.theme.json` / `.theme.zip` 的新导入、导出入口已移除；[旧格式说明](custom-themes.md) 和 [旧资源包说明](theme-packages.md) 仅供兼容与迁移查阅。本文不会增加协议字段，也不要求已安装主题更换格式版本。

## 最小主题

主题目录根部放置以下两个 UTF-8 JSON 文件。此示例不依赖字体、图片或宿主源码。

`manifest.json`：

```json
{
  "id": "example.ocean-glass",
  "displayName": "Ocean Glass",
  "author": { "name": "Your name" },
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "theme",
  "sources": [],
  "theme": {
    "displayName": "Ocean Glass",
    "names": { "zh": "海色玻璃", "en": "Ocean Glass" }
  }
}
```

`theme.json`：

```json
{
  "version": 1,
  "colorMode": "dark",
  "accentColor": "#91c5ff",
  "headerBackground": "#142536",
  "footerBackground": "#182b3b",
  "chromeBorder": "#486072",
  "background": "linear-gradient(135deg, #10202e, #171d30)",
  "tokens": {
    "--color-bg": "#10202e",
    "--color-bg-l": "#182d3d",
    "--color-bg-l2": "#21394a",
    "--color-bg-d": "#0b1722",
    "--color-text": "#eaf1f5",
    "--color-text-l": "#bdcbd6",
    "--color-text-l2": "#a5b8c6",
    "--color-border": "#486072",
    "--color-border-l": "#607c8f",
    "--color-hover": "rgb(145 197 255 / 8%)",
    "--color-hover-bg": "#294658",
    "--ep-button-radius": "0.5rem"
  },
  "rules": {
    ".ep-dialog-panel": { "border": "1px solid var(--color-border)" }
  }
}
```

在插件仓库中运行 `npm run pack:theme -- <主题目录> dist/examples`，安装生成的 `.epp` 并选择深色外观。正式发布时使用自己的 ID 命名空间；修改已发布包时递增插件 `version`，不更换 ID。

## 明暗模式与覆盖关系

`colorMode` 声明主题的设计模式，不修改用户的明暗偏好，也不提供第二套条件色板。当前数据格式不支持 `lightTokens`、`darkTokens` 或 `@media`。

| 场景                               | 宿主行为                                                             | 作者需要检查                                             |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| 选中主题，用户模式匹配 `colorMode` | 应用主题的 tokens、rules、资源槽位和文本；旧用户主题的同名声明仍优先 | 完整表面、文字、按钮和资源效果                           |
| 选中主题，用户切到另一模式         | 背景场景仍可能显示，设计模式专用样式和槽位不再应用                   | 背景回退、栏位和宿主基础控件的跨模式表现                 |
| 浅色模式显示深色场景               | 页面可使用局部深色对比度；深色栏位保留自身风格，部分主题栏位轻抬亮度 | 页面和栏位上的实际文字；不要假设浅色模式一定是深色文字   |
| 菜单或对话框 Teleport 到 body      | 不继承原页面或栏位的局部配色，按根文档当前配色及有效主题样式显示     | 弹层独立检查；不要只验证触发按钮所在区域                 |
| 启用原生窗口材质                   | 网页背景隐藏；有效原生背景由系统绘制，主题插件的设计样式暂不应用     | 材质开关前后及关闭后的恢复                               |
| 迷你播放器 / 桌面歌词              | 独立文档，不注入主窗口的 rules、图片或包字体                         | 迷你窗口会同步有效配色和歌曲材质；桌面歌词有独立颜色设置 |

用户的浅色/深色选择、背景选择、强调色来源和原生材质分别管理。不要通过主题修改内部 `.dark` 类、文档属性或用户偏好，也不要依赖选择主题时强制改变模式。

浅色模式**不叠加宿主全局白色遮罩**；深色模式仍可能使用背景可读性遮罩。`--ep-background-scrim` 用于深色场景的遮罩，`--ep-background-image-overlay` 是作者声明的图片叠层；后者若写入白色渐变，就是主题自身的效果。不能假定切到浅色会自动把原图调亮。

## 配色按语义成组设计

| 角色       | 公共变量 / 类                                                                                       | 适配要求                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 主操作     | `accentColor`、`--color-primary`、`--color-primary-fill`、`--color-on-primary`、`--btn-primary-*`   | 通常只声明场景强调色，让宿主计算前景与悬停色                               |
| 正文与说明 | `--color-text`、`--color-text-l`、`--color-text-l2`                                                 | 与页面、卡片、下拉和栏位表面一起检查；辅助字也应可读                       |
| 表面与边框 | `--color-bg`、`--color-bg-l`、`--color-bg-l2`、`--color-bg-d`、`--color-border`、`--color-border-l` | 主底色、卡片和内嵌区域形成稳定层次，避免同时修改亮度导致层级消失           |
| 危险操作   | `--color-danger`、`--btn-danger-*`、`.ep-button--danger`                                            | 默认危险按钮从危险色与当前材质衍生；不要逐页写固定红底白字                 |
| 状态提示   | `--color-success`、`--color-warning`、`--color-danger`                                              | 浅色使用较深的状态文字，深色使用较亮状态文字；保留状态含义                 |
| 选中与悬停 | `--color-hover`、`--color-hover-bg`、`.ep-select-option`、`.ep-menu-item`                           | 内置 Select/Menu 使用 8% 强调色选中底、4% 活动底；覆写后重新测量文字对比度 |

主按钮已统一使用同一语义样式，包括接入 `.ep-button--primary` 的业务按钮和播放控制。`.ep-button` 仍只表示基础按钮组件，不能据此假设所有业务按钮拥有相同尺寸或内部 DOM。

宿主根据有效强调色或歌曲填充计算黑/白前景及悬停填充；因此不要再给所有主按钮固定 `color: white`，也不要通过 `filter: brightness(...)` 另做一套悬停调色。如果独立覆写 `--btn-primary-bg`、`--color-primary-fill`、组件背景图或渐变，必须同时验证对应前景和悬停色。宿主不会分析任意作者 CSS 的最终像素来重算文字。

例如，独立指定按钮填充时，应成组声明以下内容，而不是只改背景：

```json
{
  "tokens": {
    "--color-primary": "#91c5ff",
    "--color-primary-fill": "#91c5ff",
    "--color-on-primary": "#081019",
    "--btn-primary-bg": "var(--color-primary-fill)",
    "--btn-primary-text": "var(--color-on-primary)",
    "--btn-primary-bg-hover": "#b7ddff"
  }
}
```

这是 `theme.json` 的字段片段，不是完整主题。局部深色栏位有自己的派生变量；根级 `!important` 不能跨元素覆盖后代声明。应在实际按钮所在区域验证，不把根文档 computed style 当成所有区域的最终值。透明填充与背景图片还要按实际叠加后的颜色检查。

## 样式接口与资源

优先复用语义变量；规则只使用公开 `.ep-*` 类。允许单个类或用单个空格连接的后代类，以及 `:hover`、`:focus-visible`、`:disabled`。不能使用 `.dark`、属性选择器、标签选择器、选择器列表、伪元素或原始 stylesheet。变量名有公开前缀不代表存在消费方，具体名称和类型以变量参考为准。

`--_theme-*` 等内部变量、背景层数据属性、Vue scoped 属性和 Tailwind 类不属于作者接口。不要复制宿主局部配色声明，或通过内部 DOM 覆盖背景交接状态。

图片和字体放入 `assets.resources`，通过 `assets.slots` 引用；不在规则里写 `url()`、安装目录或内部协议地址。图片槽位生成背景图，只改底色时使用 `background-color`，`background` 简写会清空已有图片。主背景优先提供不透明且与画面接近的 `background` 回退，减少加载或故障时的亮度变化。该字段是颜色/渐变，不是旧格式的 `replace/inherit`。

## 背景就绪与统一过渡

宿主负责预加载和解码背景、保留旧画面、暂存页面配色，并在新背景就绪后让背景、Header、Footer 和控件一起切换。默认使用 `--motion-duration-theme: 220ms` 和 `--motion-ease-standard`；支持时使用整页 View Transition，缺少该能力时降级为背景层淡入。

需要调整节奏时统一修改上述公开变量，不分别给栏位、文字和背景增加延迟或独立的颜色过渡。减少动态效果或原生材质切换遵循宿主策略，不要求作者模拟相同动画。

第三方静态/shader 主题无需发送 `ready` 消息或管理文档切换。`renderer: { entry }` 及其 ready/paused/dispose 协议仍只用于认证官方主题；第三方不能借此携带 JS/Vue/HTML 入口。

## 发布验收

1. 检查设计模式、另一模式和跟随系统；包含普通背景、原生材质开关及恢复。切换背景不会改写已保存偏好。
2. 检查主按钮、危险按钮、状态文字、禁用态、焦点、菜单和实际弹层。项目按普通文字至少 4.5:1 验收，辅助说明不作为不可读文字处理；图标和大字单独检查。
3. 检查主页、歌曲列表、Header/Footer、播放页及迷你窗口。封面黑、白、红、绿、蓝取色时也要可读；歌词、封面叠层和安全恢复对话框有各自的颜色规则。
4. 检查首次加载、延迟图片、快速连续切换、加载失败、减少动态效果、窗口隐藏/失焦、停用与恢复。背景回退、完成画面和控件配色应保持协调。
5. 检查中英文、数字及缺字回退；字体和图片加载成功后再查看真实字形。核对资源许可、更新版本、重启与卸载。

宿主尚未提供逐栏位亮度判断或任意背景图片的区域亮度分析。近白自定义栏位、跨模式浅色栏位以及高亮图片区域可能与局部文字冲突，需要作者实际检查；不能将自动按钮前景计算等同于任意配色的可读性保证。当前检查范围见 [主题系统检查报告](theme-audit.md)。

作者在插件仓库执行打包校验和示例测试，不需要检出宿主源码。宿主维护者准备好 `build/plugins` 中的主题测试包和生产 CSS 后，可执行：

```sh
npm run test:theme-contract
npm run test:theme-system
npm run test:appearance
npm run test:background-transition
npm run test:ui
```

需要生成测试包与生产 CSS 时，宿主维护者先运行 `npm run build:plugins`、`npm run build`；前者需要已配置的独立插件仓库。这些检查覆盖公共接口和已有测试主题，不会自动替作者验收任意新 `.epp`。
