# 多格式歌词支持开发计划

## 目标

将内嵌标签、本地文件、数据库和网络接口返回的歌词统一为格式化载荷，并通过单一解析入口转换为播放器可渲染的标准歌词文档。第一阶段保证现有 LRC/ELRC 完全兼容并补足缺失能力，后续按 YRC、TTML 的顺序接入逐字与多轨歌词。

## 分层设计

```text
歌词来源 → LyricPayload → detectLyricFormat / parseLyrics → LyricDocument → 播放器与桌面歌词
```

- **歌词来源**：内嵌标签、同目录本地文件、数据库缓存、网络 API。
- **LyricPayload**：原始文本、可选格式、翻译/音译轨道、来源和文件路径。
- **解析层**：格式检测后分派至 LRC、ELRC、YRC 或 TTML 解析器。
- **LyricDocument**：包含元数据、时间轴行、翻译、音译及逐字时间。
- **渲染层**：只读取标准模型，不判断输入格式。

## 标准模型

```ts
type LyricFormat = 'lrc' | 'elrc' | 'yrc' | 'ttml' | 'plain'

interface LyricPayload {
  content: string
  format?: LyricFormat
  translation?: { content: string; format?: LyricFormat }
  romanization?: { content: string; format?: LyricFormat }
  source: LyricSource
  path?: string
}

interface LyricDocument {
  format: LyricFormat
  metadata: { title?: string; artist?: string; album?: string; offsetMs: number }
  lines: LyricLine[]
}

interface LyricLine {
  timeMs: number
  endMs?: number
  text: string
  translation?: string
  romanization?: string
  words?: Array<{ text: string; startMs: number; endMs: number }>
}
```

## 实施阶段

### 阶段 1：统一入口与 LRC/ELRC

1. 增加格式识别与 `parseLyrics()` 统一入口，同时保留 `parseLrc()` 兼容调用。
2. 支持 LRC 的元数据、`[offset]`、两/三位小数或冒号百分秒、多时间标签及无时间纯文本降级。
3. 使用时间容差合并翻译，避免不同精度的时间戳丢失翻译。
4. 重写 ELRC token 解析，支持词、空格、标点、emoji 与逐字结束时间推导。
5. 为解析器添加格式夹具与回归测试。

### 阶段 2：YRC

1. 解析网易云 YRC 的行级时间和词级时间元组。
2. 将词级数据映射为标准 `words`，复用逐字渲染。
3. 网络接口保留 YRC 原文及翻译/音译轨道，禁止预先降级为 LRC。

### 阶段 3：TTML

1. 仅解析安全白名单节点与时间属性：`tt/body/div/p/span`、`begin/end/dur`。
2. 支持行级、span 级时间及常用时间表达式。
3. 通过语言或角色标记合并翻译、音译轨道。
4. 限制输入大小、行/词数量，拒绝外链、样式脚本和非白名单内容。

### 阶段 4：来源、存储与管理器

1. 本地歌词按 `elrc/yrc/ttml/lrc` 发现并按优先级选择。
2. IPC 返回带格式的 payload，而非裸字符串。
3. 数据库存储格式和可选音译轨道；旧 `lrc/translation` 数据默认按 LRC 兼容读取。
4. 歌词管理器展示格式与轨道，第一期保留 LRC 编辑，复杂格式先只读预览。

## 兼容性与验收

- 已有数据库 LRC、网络缓存和桌面歌词必须继续工作。
- 解析异常、空内容、时间倒序或超大文件必须安全降级且不能阻塞播放。
- 覆盖普通 LRC、翻译 LRC、ELRC、YRC、TTML、无时间文本与损坏输入的夹具测试。
- 新增格式不应增加播放期间的持续解析或轮询；解析仅在歌词加载/切歌时执行。

## 当前进度（首轮）

- 已完成统一载荷、格式检测、LRC/ELRC/YRC/TTML 的解析入口与旧 `parseLrc()` 兼容层。
- 已完成本地扩展名发现、网易云 YRC/翻译/音译透传，以及 IPC payload 化。
- 已完成数据库 v2 迁移：保存主歌词、翻译和音译的格式；旧字段保持兼容。
- 后续需补充真实格式夹具、TTML 多轨（语言/角色）合并、管理器的复杂歌词只读预览。
