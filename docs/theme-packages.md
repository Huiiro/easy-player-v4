# 带资源的主题包规范

资源包使用 `.theme.zip`，入口为 **设置 → 主题 → 自定义主题**。纯配色 JSON 仍可单独导入，见 [开发规范](custom-themes.md)；所有变量见 [变量参考](theme-variables.md)。清单格式可参考 [JSON Schema](themes/manifest.schema.json)，最终以运行时校验为准，Schema 不能代替资源类型、引用及 ZIP 内容检查。

## 目录与最小文件

ZIP 根目录必须直接包含 `manifest.json`，不能将整个外层文件夹再压进去。清单负责资源登记、使用位置及指定文字；`theme.json` 负责变量与规则。下面示例列出的文件都需实际存在，字体文件请使用具备再发布许可且覆盖所需字形的资源。

```text
ocean.theme.zip
├── manifest.json
├── theme.json
├── images/background.webp
└── fonts/
    ├── interface.woff2
    └── OFL.txt
```

`manifest.json` 示例：

```json
{
  "version": 1,
  "id": "ocean",
  "theme": "theme.json",
  "resources": {
    "wallpaper": { "type": "image", "path": "images/background.webp" },
    "interface": {
      "type": "font",
      "path": "fonts/interface.woff2",
      "weight": "400",
      "style": "normal"
    }
  },
  "slots": {
    "appBackground": { "image": "wallpaper" },
    "global": { "font": "interface" },
    "sidebar": { "image": "wallpaper", "font": "interface" },
    "dialog": { "font": "interface" }
  },
  "text": {
    "appTitle": "Ocean Player",
    "homeWelcome": "欢迎来到音乐海洋"
  },
  "licenses": ["fonts/OFL.txt"]
}
```

对应的 `theme.json` 可以从以下最小声明开始，再按需补充配色：

```json
{
  "version": 1,
  "name": "Ocean Resources",
  "background": "replace",
  "tokens": {
    "--ep-sidebar-bg": "rgb(0 0 0 / 15%)"
  },
  "rules": {
    ".ep-sidebar": { "background-size": "cover" }
  }
}
```

没有图片或字体时，仍须在清单中写 `"resources": {}`、`"slots": {}`。不要把安装元数据 `package` 写进主题文件，不要添加未声明的 README、脚本、系统隐藏文件或原始 CSS；导入器会拒绝未声明文件。

## 清单字段

| 字段        | 必填 / 类型    | 约束与作用                                                                                      |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `version`   | 是，数字       | 当前只能是 `1`                                                                                  |
| `id`        | 是，字符串     | 作者包标识，1–64 位小写字母、数字、连字符，以字母或数字开头；如 `ocean-v1`                      |
| `theme`     | 是，字符串     | 包内主题路径，须为安全相对路径且以小写 `.json` 结尾；不得指向 `manifest.json`                   |
| `resources` | 是，对象       | 最多 64 个资源，键是资源 ID，值含 `type`、`path` 及可选字体描述                                 |
| `slots`     | 是，对象       | 仅支持下表槽位；值如 `{ "image": "wallpaper", "font": "interface" }`，引用资源 ID，不是文件路径 |
| `text`      | 否，对象       | 仅接受 `appTitle`、`homeWelcome` 纯文本                                                         |
| `licenses`  | 否，字符串数组 | 最多 8 个安全相对路径，以小写 `.txt` 结尾；每份不超过 64 KiB，仅随包携带与导出                  |

资源 ID 为 1–64 位小写字母、数字、连字符，必须以字母开头。`manifest.id` 与资源 ID 是两类不同标识。每次安装还会生成独立 UUID，隔离资源和字体；同名主题的替换依据 `theme.json` 的 `name`，不是 `manifest.id`。

### 资源声明

| 字段     | 类型 / 默认              | 说明                                                                                       |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `type`   | 必填，`image` / `font`   | 须与文件扩展名及实际文件头格式一致                                                         |
| `path`   | 必填，字符串             | 相对主题包根目录的路径                                                                     |
| `weight` | 可选，字符串，默认 `400` | 字体字重；只接受 `100` 到 `900` 的整百数字，或两个整百值用单个空格组成的范围，如 `100 900` |
| `style`  | 可选，默认 `normal`      | 字体样式，`normal` / `italic`                                                              |

`weight`、`style` 用于字体描述，图片资源请省略。可变字重范围必须与字体真实能力一致，范围按低到高填写。当前一个槽位指定一个字体资源，不能把字体资源 ID 数组当成多字体族配置；多个字重/斜体也不会自动合并为同一字体族。

支持图片：`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`；支持字体：`.woff`、`.woff2`、`.ttf`、`.otf`，扩展名大小写均可。建议使用 WOFF2 并按所需字符合理压缩。SVG、AVIF、TTC、视频及远程字体不在支持范围内。

### 路径约定

路径最多 160 位，规则为：

```text
^(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$
```

允许 `images/bg-main.webp`、`fonts/interface_regular.woff2`。不允许空格、中文文件名、目录中的点、`..`、反斜杠、绝对路径、盘符、查询参数或 URL。文件名只有最后一处扩展名分隔点；例如 `font.v2.woff2` 不符合规则。引用使用准确大小写；ZIP 中大小写不同的重复条目也会被拒绝。

## 图片与字体作用位置

| 清单槽位        | 对应节点 / 范围                                         | 图片 | 字体 |
| --------------- | ------------------------------------------------------- | ---- | ---- |
| `appBackground` | `.ep-app-background`，主界面背景层                      | 是   | 否   |
| `home`          | `.ep-home`，主页内容容器                                | 是   | 是   |
| `sidebar`       | `.ep-sidebar`，侧边栏                                   | 是   | 是   |
| `header`        | `.ep-header`，标题栏                                    | 是   | 是   |
| `footer`        | `.ep-footer`，底部播放栏                                | 是   | 是   |
| `button`        | `.ep-button`，BaseButton                                | 是   | 是   |
| `dialog`        | `.ep-dialog-panel`，BaseDialog 面板                     | 是   | 是   |
| `drawer`        | `.ep-drawer-panel`，BaseDrawer 面板                     | 是   | 是   |
| `menu`          | `.ep-menu`，菜单                                        | 是   | 是   |
| `playbackThumb` | `.ep-playback-progress`，底栏与播放器详情的播放进度滑块 | 是   | 否   |
| `global`        | `body, button, input, select, textarea`，主渲染文档字体 | 否   | 是   |

未知槽位、不支持的图片/字体组合、资源 ID 不存在或类型不匹配都会拒绝导入。主题不是自由 DOM 注入，不能自行指定任意图片、文字加载点。

### 图片行为

普通图片槽位生成 `background-image`，默认居中、`cover`、无重复。可通过对应 `.ep-*` 类的 `background-size`、`background-position`、`background-repeat` 调整；图片不会替换节点内容，也不会改变容器高度。作者规则若使用 `background` 简写会重置背景图，修改底色时请使用 `background-color`。

`appBackground` 图片要求主题 `background: "replace"`（默认）。若只想首页内容区有图、其他页面保留原背景，可设 `background: "inherit"`，将图片分配给 `home`。图片上方的组件可能有不透明表面，需检查真实层级和可读性。

`playbackThumb` 生成局部 `--ep-range-thumb-image`，图片使用 `contain`、居中、无重复、像素化渲染。使用 `--ep-range-thumb-width`、`--ep-range-thumb-height`、`--ep-range-thumb-bg`、`--ep-range-thumb-radius` 调整大小、底色与圆角；使用 `--ep-range-track-height` 和 `--ep-range-fill-background` 调整轨道。它不会给所有音量滑块添加图片。参考 [图片进度滑块示例](themes/nyan-cat.theme.zip) 及其 [主题声明](themes/nyan-cat/theme.json)。

### 字体行为

加载器通过 `FontFace` 注册包字体，并自动生成含安装 UUID 的字体族名称；作者不要写死 `EPTheme-...` 内部字体族。普通区域字体同时应用到该区域及其中的 `button`、`input`、`select`、`textarea`，区域字体优先于全局字体。主布局中用户显式指定的字体、组件自身字体声明仍受实际继承和 CSS 优先级影响。

字体缺少中文、数字或标点时，对应字符会回退到 `sans-serif`。格式校验通过仍可能无法解码；异步加载失败会记录警告并使用回退字体，字体加载不单独弹窗。声明 `weight: "400"` 不代表真实文件就含所需粗体或全部字形，应在实际页面验证中文、英文、数字与强调文字。

切换时卸载旧包字体，并用加载代次阻止旧异步结果污染新主题。主窗口注册的字体不自动共享给迷你播放器或桌面歌词等独立窗口。建议测试：导入后观察真实字形、切换默认再切回、导出后重新导入、关闭并重启应用。

## 文字槽位与优先级

| 字段               | 显示位置           | 回退与优先级                                                                       |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------- |
| `text.appTitle`    | 主窗口顶栏品牌文字 | 声明后替代顶栏 `logoText` 展示，未声明使用用户原值；不是操作系统窗口标题或程序名称 |
| `text.homeWelcome` | 首页欢迎语         | 用户自定义内容（去空白后非空）→ 主题内容（去空白后非空）→ 默认问候语               |

每项最多 200 个 JavaScript 字符串长度单位，作为 Vue 纯文本插值，不解析 HTML。`appTitle` 的空字符串是显式值，会显示为空；想保留原值请省略字段。首页欢迎语的空白内容会继续回退。主题不会改写用户保存的品牌文字、欢迎语或字体偏好，停用后按原设置展示。

只能使用这两个文字槽位，不能替换歌曲标题、艺术家、歌词或任意界面文案。

## 容量与安装生命周期

所有容量使用二进制单位：1 KiB = 1024 字节，1 MiB = 1024 KiB。

| 项目             | 上限 / 规则                                                       |
| ---------------- | ----------------------------------------------------------------- |
| ZIP 文件         | 32 MiB                                                            |
| ZIP 条目         | 128 项，目录也计数                                                |
| 解压总量         | 64 MiB                                                            |
| 单文件           | 16 MiB，另有更小上限的文件按下方限制                              |
| 清单 / 主题 JSON | 各 128 KiB；安装后合并主题与清单的声明仍受主题解析器 128 KiB 限制 |
| 图片/字体资源数  | 64                                                                |
| 许可文件         | 8 个，每个 64 KiB                                                 |
| ZIP 压缩         | Store 或 Deflate；拒绝加密、符号链接和重复条目                    |

仅清单、主题、`resources`、`licenses` 声明的文件会被写入；不会通用解压整个包。许可文件不能与其他声明文件冲突，也不会作为图片或字体加载。

只有导入 JSON / ZIP（包括同名重导）触发 **10 秒预览确认**。确认后保存；取消、Escape 或超时恢复前一主题并清理本次新资源。同名替换在确认前保留旧主题及其资源。已安装主题切换、默认、内置或自定义背景选择立即生效，不再弹确认或自动回退。确认框独立于主题样式，未确认导入不会在重启后自动启用。

资源安装到应用数据目录的 `player_data/themes/<安装 UUID>`。移走原 ZIP 不影响加载；只通过内部 `easy-player-media://theme/<安装 UUID>/<资源路径>` 协议访问已声明资源，作者无需也不应手写这些 URL。导出打包清单、主题、资源与许可文件，不含机器绝对路径。删除主题或确认同名替换后清理旧资源；停用和切换保留已安装资源。

“默认（不覆写）”停用覆写，恢复当前内置外观，并保留已安装主题；有未确认预览时会先取消。完整开关行为见 [开发规范](custom-themes.md#导入保存与卸载)。

## 安全边界

这是**声明式主题包**，不是脚本插件。导入会检查大小、路径、文件声明、资源格式头与槽位类型，CSS 不接受脚本、外部资源 URL、CSS 转义或原始 stylesheet。内部协议只服务清单登记的图片/字体，并检查资源真实路径位于安装目录内。

这些限制不等同于对第三方内容的安全认证：图片/字体仍交给 Chromium 解码，文件头匹配不代表完整文件一定可用；主题规则也可能隐藏控件、造成低对比度、遮挡或增加渲染负担。预览确认帮助恢复可操作外观，不能代替内容来源判断。作者应使用可信素材、控制资源体积、保留所需许可，并测试取消/超时恢复。

## 示例与维护

- [资源演示 ZIP](themes/resource-demo.theme.zip) 与 [源目录](themes/resource-demo/)：图片、区域与文字分配。
- [图片进度滑块 ZIP](themes/nyan-cat.theme.zip) 与 [源目录](themes/nyan-cat/)：滑块图片及资源许可声明。
- [清单 Schema](themes/manifest.schema.json)：辅助编辑器提示，最终约束以 [清单校验](../src/shared/themePackage.ts) 与 [主进程导入器](../src/main/service/themePackageService.ts) 为准。

新增槽位需同时修改注册表、Schema、校验与文档；不要仅在包里新增名称。当前没有 `minAppVersion` 自动版本判断，面向较旧应用发布时应明确所需功能版本，并测试目标版本导入。
