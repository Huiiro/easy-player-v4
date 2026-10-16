# 带资源的主题包

设置 → 外观 → 自定义主题中可导入 `.theme.zip`。ZIP 根目录必须放置 `manifest.json`。纯配色 `.theme.json` 保持兼容。

```text
ocean.theme.zip
├── manifest.json
├── theme.json
├── images/background.webp
└── fonts/interface.woff2
```

清单负责资源登记、字体/图片的使用位置以及可替换的文字内容；theme.json 继续负责颜色、样式变量和组件规则。

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
  }
}
```

## 支持的位置

| 清单槽位      | 区域                     | 图片 | 字体 |
| ------------- | ------------------------ | ---- | ---- |
| appBackground | 整个主界面背景           | 是   | 否   |
| home          | 主页内容区域             | 是   | 是   |
| sidebar       | 侧边栏                   | 是   | 是   |
| header        | 标题栏                   | 是   | 是   |
| footer        | 底部播放栏               | 是   | 是   |
| button        | BaseButton 按钮          | 是   | 是   |
| dialog        | 对话框                   | 是   | 是   |
| drawer        | 抽屉                     | 是   | 是   |
| menu          | 菜单                     | 是   | 是   |
| playbackThumb | 播放进度条滑块           | 是   | 否   |
| global        | 全局文字（包含表单控件） | 否   | 是   |

分配图片后默认居中、cover、无重复；可以用该区域的公开 `ep-*` 类覆写 background-size、background-position 等样式。`appBackground` 图片需要主题的 `background` 为 `replace`（默认值）。区域字体优先于全局字体。未分配的区域继承默认主题或全局字体。

文字仅允许 `text.appTitle` 和 `text.homeWelcome`，每项最多 200 个字符，作为纯文本展示，不解析 HTML。不会修改用户原本保存的应用标题、欢迎语或字体偏好，停用主题后恢复。主题无法替换歌曲标题、艺术家、歌词等曲库内容。

## 文件与生命周期

`playbackThumb` 图片以 contain、像素清晰的方式用于播放进度条滑块。可用 `--ep-range-thumb-width`、`--ep-range-thumb-height`、`--ep-range-thumb-bg`、`--ep-range-thumb-radius` 设置尺寸和底色，`--ep-range-track-height` 调整轨道粗细，`--ep-range-fill-background` 设置已播放轨道渐变。示例见 `docs/themes/nyan-cat.theme.zip`。

字体许可可以通过清单中的 `"licenses": ["fonts/OFL.txt"]` 一并携带和导出。最多 8 个 `.txt` 文件，每个不超过 64 KB；许可文件不会作为图片或字体加载。

- 图片支持 PNG、JPEG、WebP、GIF；字体支持 WOFF、WOFF2、TTF、OTF。优先使用 WOFF2。资源损坏或字体无法解析时回退到默认字体。
- 文件名使用英文字母、数字、下划线和连字符，通过 `/` 连接子目录。路径必须相对主题包根目录。所有文件都需被清单引用，不携带脚本或原始 CSS。
- ZIP 最大 32 MB，解压总量最大 64 MB，单文件最大 16 MB；最多 128 项、64 个资源。manifest.json 与 theme.json 各最多 128 KB；安装后的合并主题声明也受导入器大小限制。
- 导入后保存到应用数据目录的 `player_data/themes/<安装ID>`，移走原 ZIP 不影响加载。只通过内部资源协议访问清单内的资源。
- 导出会打包清单、主题和所声明的资源；删除、同名替换会移除旧资源目录。切换主题会卸载旧字体，并阻止旧的异步字体加载结果影响新主题。
- `manifest.id` 是作者的标识；每次安装有独立安装 ID，保证同名资源不会串用。导出包不包含机器上的绝对路径。

完整可测试示例见 `docs/themes/resource-demo.theme.zip`，源目录为 `docs/themes/resource-demo/`。示例携带图片及文字分配；字体按上面的清单声明加入即可。
