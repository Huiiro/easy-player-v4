# 主进程路径与协议说明

本文对应 `src/main` 当前实现。应用名称为 `EasyPlayer`，应用数据根目录名称为 `easy_player`。
固定目录和运行资源路径统一由 [utils/pathUtils.ts](./utils/pathUtils.ts) 定义和获取；业务模块负责具体文件的读写、生命周期和访问校验。
开发环境不自动迁移或删除旧目录，已有协议名保持不变。

## 1. 路径使用约定

- 使用对应的命名 getter，例如 `getCoverPath(fileName)`，避免在业务模块重新拼接 `player_data/covers`。
- 支持 `...parts` 的 getter 可获取目录本身，也可获取其下文件路径；它们只拼接路径，不创建文件、不检查文件是否存在，也不提供目录穿越防护。
- 用户选择的文件、远程资源路径和包内相对路径仍由对应业务模块解析与校验。传入 getter 的动态路径段必须经过业务校验。
- 判断文件是否位于允许目录内时，保留 `resolve`、`relative`、`isAbsolute` 等边界检查；需要防止符号链接逃逸的场景还需 `realpath`、`lstat`。
- 渲染进程通过 IPC 获取资源信息或协议 URL，不直接导入主进程的 `pathUtils`。
- 新增固定位置时，先在 `pathUtils` 增加 getter，再更新业务调用、测试替身和本文。

## 2. 应用数据路径

### 2.1 根目录与环境变量

`getBaseDir()` 优先读取 `EASY_PLAYER_DATA_DIR`，并使用 `path.resolve()` 转为绝对路径。
未设置该变量时使用以下位置：

| 平台             | 默认根目录                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Windows          | `%APPDATA%/easy_player`；`APPDATA` 缺失时使用 `os.homedir()/AppData/Roaming/easy_player` |
| macOS            | `~/Library/Application Support/easy_player`                                              |
| Linux 等其他平台 | `$XDG_CONFIG_HOME/easy_player`；未设置时使用 `~/.config/easy_player`                     |

[主进程入口](./index.ts) 在创建窗口、打开数据库之前，将 Electron `userData` 设置为 `getBaseDir()`。
Electron 会话数据与应用库、插件、日志共享同一根目录，不随显示名称变化。

开发或测试隔离示例（PowerShell，在启动应用前设置）：

```powershell
$env:EASY_PLAYER_DATA_DIR = 'D:\temp\easy_player_dev'
npm run dev
```

该变量覆盖数据根目录，**不覆盖系统临时目录、开发构建目录或只读资源目录**。
生成的人声分轨在开发、正式环境均使用 `getStemCachePath()`（`<base>/player_data/auto-mix-stems`）。可选 Python 运行时和模型单独安装在 `<base>/player_data/components/auto-mix`，由 `installed.json` 指向已验证的版本目录。两者均随数据根目录变量覆盖，并独立于通用 `cache`。

### 2.2 数据目录与文件 getter

下表中的 `<base>` 为 `getBaseDir()`：

| getter                        | 返回位置                                  | 用途与主要调用处                                                                            |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `getBaseDir()`                | `<base>`                                  | Electron `userData`，入口初始化                                                             |
| `getDataPath(...parts)`       | `<base>/player_data/...parts`             | 通用应用数据目录；有专用 getter 时优先使用专用 getter                                       |
| `getDatabasePath()`           | `<base>/player_data/player.db`            | [database/colors.ts](./database/index.ts)；歌曲、歌单、设置和来源等 SQLite 数据              |
| `getPluginPath(...parts)`     | `<base>/player_plugin/...parts`           | [plugins/management.ts](./plugins/management.ts) 中的插件包管理器                           |
| `getLogPath(...parts)`        | `<base>/player_log/...parts`              | [service/loggerService.ts](./service/loggerService.ts)，如 `log-YYYY-MM-DD.log`（UTC 日期） |
| `getCachePath(...parts)`      | `<base>/player_data/cache/...parts`       | 远程音频默认缓存等                                                                          |
| `getStemCachePath()`          | `<base>/player_data/auto-mix-stems`        | 开发与正式环境共享的分轨结果，独立于通用缓存清理范围                                         |
| `getStemRuntimeRoot()`        | `<base>/player_data/components/auto-mix`  | 可选运行时和模型的版本目录及安装状态，不随普通缓存清理                                       |
| `getCoverPath(...parts)`      | `<base>/player_data/covers/...parts`      | 本地封面、歌单封面及 `remote/` 下的远程封面                                                 |
| `getFontPath(...parts)`       | `<base>/player_data/ttf/...parts`         | 用户字体，支持 TTF、OTF、WOFF、WOFF2                                                        |
| `getBackgroundPath(...parts)` | `<base>/player_data/backgrounds/...parts` | 导入的 MP4 背景视频                                                                         |
| `getThemePath(...parts)`      | `<base>/player_data/themes/...parts`      | [service/themePackageService.ts](./service/themePackageService.ts) 管理的独立主题资源包     |
| `getDataTempPath(...parts)`   | `<base>/player_data/temp/...parts`        | 应用数据内预留临时目录，与系统临时目录不同                                                  |

远程音频缓存允许用户在 `remote.cache-directory` 设置中指定其他位置；未配置时使用 `getCachePath()`。
`getDatabasePath()` 是默认数据库位置，`initDatabase(overridePath)` 仍支持显式路径，供测试和工具使用。

使用示例：

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { getCoverPath } from './utils/pathUtils'

mkdirSync(getCoverPath(), { recursive: true })
const destination = getCoverPath('example.jpg')
writeFileSync(destination, imageBytes) // imageBytes 为业务代码提供的图片数据
```

### 2.3 目录创建与插件包布局

`createDir()` 递归创建根目录、`player_data`、`player_plugin`、`player_log`，以及数据目录下的
`cache`、`covers`、`temp`、`ttf`。成功返回 `true`；失败记录错误并返回 `false`，入口会终止初始化。
`backgrounds`、`themes` 等目录由对应业务在写入时按需创建。

插件管理器以 `getPluginPath()` 为根目录，其内部布局由 [plugins/packages.ts](./plugins/packages.ts) 管理：

```text
player_plugin/
  catalog.json
  <pluginId>/
    current.json
    <sha256>/
      manifest.json
      package.epp
      index.cjs       # 按插件种类存在
      ...            # 主题资源等包内内容
```

`player_data/themes` 与 `player_plugin` 是两套存储：前者用于独立主题资源包，后者用于托管插件及主题插件。
它们对应的协议主机分别是 `theme` 与 `plugin-theme`。

## 3. 临时路径

| getter                                | 返回值                                         | 使用方式                                                |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `getSystemTempPath(...parts)`         | `os.tmpdir()/...parts`                         | 系统临时目录下的路径，不受数据根目录覆盖影响            |
| `getExportTempPath()`                 | 系统临时目录下的 `easy_player_export_<时间戳>` | 资料库导出工作目录，返回路径后由导出服务创建            |
| `getMetadataTempPrefix()`             | 系统临时目录下的 `easy_player_metadata_` 前缀  | 交给 `fs.mkdtemp()` 创建音频元数据兼容处理目录          |
| `getLyricTimelinePath(id)`            | 系统临时目录下的 `lyric-timeline-<id>.json`    | 歌词时间轴工具的交换文件，由调用处安排清理              |
| `getDownloadStagingPrefix(directory)` | 指定目录下的 `.easy_player_download_` 前缀     | 交给 `fs.mkdtemp()`，下载校验与封装完成后再发布最终文件 |

`getMetadataTempPrefix()` 和 `getDownloadStagingPrefix()` 返回的是 **mkdtemp 前缀**，不是已经创建的目录。
临时文件清理由创建它们的业务负责，getter 本身不执行清理。

## 4. 开发与打包资源路径

### 4.1 入口目录基准

入口先调用 `setMainDirectory(__dirname)`，再获取运行资源路径。
这个显式基准用于避免 Rollup 将公共代码放入 `out/main/chunks` 后，公共模块的 `__dirname` 改变资源定位。
独立工具调用运行资源 getter 时，也应先设置正确的入口目录；未设置时 `getMainPath()` 回退到模块自身的 `__dirname`。

下表使用这些符号：

- `<main>`：入口目录，构建后通常为 `out/main`。
- `<project>`：`<main>/../..`，开发时为项目根目录。
- `<resources>`：Electron 的 `process.resourcesPath`，是安装包资源根目录。

`pathUtils` 不导入 Electron。需要开发/打包分支的函数由调用处传入 `app.isPackaged`；
`getYtdlpCommand()` 还需传入 `app.getAppPath()`。

| getter                                       | 开发模式                                                                               | 打包模式或补充说明                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `getMainPath(...parts)`                      | `<main>/...parts`                                                                      | 同样相对入口目录                                                                                                        |
| `getProjectPath(...parts)`                   | `<project>/...parts`                                                                   | 主要用于开发构建产物，打包资源优先使用专用 getter                                                                       |
| `getResourcePath(isPackaged, ...parts)`      | `<project>/resources/...parts`                                                         | `<resources>/resources/...parts`                                                                                        |
| `getIconPath(isPackaged)`                    | `resources/icons/easy-player.ico`（Windows），其他平台为 `.png`                        | 相同资源名，使用打包资源根目录                                                                                          |
| `getTrayIconPath(isPackaged)`                | macOS 使用 `resources/icons/easy-playerTemplate.png`                                   | 其他平台使用 `getIconPath()`                                                                                            |
| `getDockIconPath(isPackaged)`                | `resources/icons/easy-player.icns`                                                     | `<resources>/icon.icns`                                                                                                 |
| `getPreloadPath()`                           | `<main>/../preload/index.js`                                                           | 预加载脚本路径                                                                                                          |
| `getRendererPath(extremeView = false)`       | `<main>/../renderer/index.html`                                                        | `true` 时为 `extreme.html`；开发 HMR URL 由入口另行处理                                                                 |
| `getSearchWorkerPath()`                      | `<main>/searchWorker.js`                                                               | 搜索 Worker 入口                                                                                                        |
| `getNativeAddonPath(isPackaged)`             | `<project>/build/native-addon/easy_player_native.node`                                 | `<resources>/native/easy_player_native.node`                                                                            |
| `getStemPythonPath()` | `<base>/player_data/components/auto-mix/versions/<active>/python/python.exe` | 相同；安装可选组件后可用，`EASY_PLAYER_STEM_PYTHON` 优先覆盖 |
| `getStemFfmpegPath(isPackaged)`              | 优先 `<project>/build/native-addon/ffmpeg.exe`，其次 `build/native-deps/installed/x64-windows-audio/tools/ffmpeg/ffmpeg.exe`（Windows，均来自锁定的音频构建） | `<resources>/native/ffmpeg.exe`（Windows），与播放引擎共用 DLL；`EASY_PLAYER_STEM_FFMPEG` 优先覆盖 |
| `getStemModelPath()` | `<base>/player_data/components/auto-mix/versions/<active>/models` | 相同；模型不随基础安装包携带 |
| `getStemWorkerPath(isPackaged)`              | `<project>/resources/auto-mix/stem_worker.py`                                          | `<resources>/resources/auto-mix/stem_worker.py`                                                                         |
| `getStemCachePath()`                         | `getDataPath('auto-mix-stems')`                                                        | `getDataPath('auto-mix-stems')`                                                                                         |
| `getYtdlpCommand(isPackaged, appPath)`       | `<appPath>/resources/lib/yt-dlp/<平台>/yt-dlp[.exe]`                                   | `<resources>/lib/yt-dlp/yt-dlp[.exe]`；优先使用存在的内置程序，其次 `EASY_PLAYER_YTDLP_PATH`，最后 `PATH` 中的 `yt-dlp` |
| `getKuromojiDictionaryPath(packageJsonPath)` | kuromoji 的 `package.json` 同目录下的 `dict`                                           | 将路径中的 `app.asar/` 替换为 `app.asar.unpacked/`，支持两种分隔符                                                      |

yt-dlp 的开发平台子目录分别为 `win`、`mac`、`linux/<process.arch>`。
图标、构建目录及第三方程序的既有文件名保持与实际资源一致，不按数据根目录的命名方式自行重命名。
打包资源复制规则见项目根目录的 [electron-builder.yml](../../electron-builder.yml)。

## 5. 应用媒体协议 `easy-player-media`

### 5.1 定义和注册

[主进程入口](./index.ts) 在应用就绪前通过 `protocol.registerSchemesAsPrivileged()` 声明：

```ts
{
  scheme: 'easy-player-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}
```

应用就绪后，`registerMediaProtocol()` 使用 `protocol.handle()` 注册请求处理器。
该协议用于向渲染进程提供允许访问的本地资源，不是任意文件读取接口，也不用于注册音频文件关联。

### 5.2 URL 格式与资源映射

下表中 `<encodedPath>` 是 `encodeURIComponent(absolutePath)` 的结果：

| URL                                                                   | 对应资源                       | 处理方式                                                            |
| --------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `easy-player-media://cover?path=<encodedPath>`                        | `getCoverPath()` 内的封面      | 返回原始资源                                                        |
| `easy-player-media://cover-thumb?path=<encodedPath>&size=256`         | `getCoverPath()` 内的封面      | Sharp 生成 JPEG 缩略图；尺寸限制为 64–1024，默认 64；失败时回退原图 |
| `easy-player-media://font?path=<encodedPath>`                         | `getFontPath()` 内的字体       | 返回原始字体资源                                                    |
| `easy-player-media://background?path=<encodedPath>`                   | `getBackgroundPath()` 内的 MP4 | 返回视频，支持单段 `Range: bytes=...` 请求                          |
| `easy-player-media://theme/<id>/<resourcePath>`                       | `getThemePath(id)` 下的资源    | 经独立主题包的 manifest 声明及真实路径校验后返回                    |
| `easy-player-media://plugin-theme/<pluginId>/<sha256>/<resourcePath>` | 当前启用主题插件的资源         | 由插件管理器验证插件、版本哈希和资源后返回                          |

使用示例：

```ts
import { getCoverPath } from './utils/pathUtils'

const cover = getCoverPath('example.jpg')
const url = `easy-player-media://cover?path=${encodeURIComponent(cover)}`
const thumbnail = `easy-player-media://cover-thumb?path=${encodeURIComponent(cover)}&size=256`
```

URL 的主机名决定资源类别，`path` 查询参数是本地绝对路径；主题两类 URL 的路径部分则是包 ID、版本哈希和包内相对路径。
主题插件 URL 优先使用插件管理器返回的 `rendererUrl`、纹理 URL 等结果，保持当前安装版本哈希一致。

### 5.3 访问边界、缓存和错误

- `cover`、`cover-thumb`、`font`、`background`：校验请求路径位于对应目录内且存在。未知主机、缺失路径、越界路径和不存在的文件返回 `404`。
- `background`：只提供 `.mp4`；正常完整响应为 `200`，有效分段响应为 `206`；不支持或无效的 Range 返回 `416`。
- `theme`：只允许读取 manifest 中声明的资源；通过真实路径、文件类型和符号链接检查防止逃逸。实现见 [service/themePackageService.ts](./service/themePackageService.ts)。
- `plugin-theme`：插件必须已安装且处于 `active` 状态，URL 哈希必须匹配当前版本；资源必须位于包管理器认可的资源集合内。失效或不可访问时返回 `404`。实现见 [plugins/packages.ts](./plugins/packages.ts) 和 [plugins/themeProtocol.ts](./plugins/themeProtocol.ts)。
- 媒体响应提供 `Access-Control-Allow-Origin: *`，支持渲染器跨源读取和 Canvas 取色；这不会扩大允许访问的目录范围。
- 成功生成的缩略图响应使用 `public, max-age=31536000, immutable` 缓存；插件主题资源响应使用 `no-store`。
- 原始封面、字体等最终文件响应可通过 `full=1` 设置 `Cache-Control: no-store`。需要原图时使用 `cover`；不要把 `full=1` 当作关闭 `cover-thumb` 缩略图处理的开关。

### 5.4 主题 iframe 通信

带官方渲染脚本的主题插件使用：

```text
easy-player-media://plugin-theme/<pluginId>/<sha256>/__frame.html
```

该 HTML 由宿主 [plugins/themeFrame.ts](./plugins/themeFrame.ts) 生成，不读取主题包自带的任意 HTML。
第三方数据主题不能使用这条宿主脚本框架入口。CSP 限制脚本来源并禁止网络连接、子框架、对象和表单等能力。

渲染器组件 [SandboxedThemeBackground.vue](../renderer/src/components/background/SandboxedThemeBackground.vue)
通过 `postMessage` 的 `channel: 'easy-player-theme'` 发送 `state`（包含暂停状态）和 `dispose`，接收 `ready`、`failed`。
`easy-player-theme` 是消息频道标识，**不是 URL scheme**；接收时还会检查消息是否来自当前 iframe。

## 6. 其他协议与通信边界

| 协议或机制                | 用途                                                                         | 定义或调用位置                                                                |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `file:`                   | 主进程通过 `pathToFileURL()` 与 `net.fetch()` 获取已验证的本地资源           | [colors.ts](./index.ts) 中的媒体协议处理器                                     |
| HTTP / HTTPS              | 开发渲染器 HMR、网络来源请求与下载；不映射应用本地数据目录                   | 入口、[service/mediaDownloadRuntime.ts](./service/mediaDownloadRuntime.ts) 等 |
| `ms-settings:defaultapps` | Windows 默认应用选择页，配合注册表中的 `EasyPlayer` 应用标识                 | [service/fileAssociationService.ts](./service/fileAssociationService.ts)      |
| Electron IPC              | 渲染器与主进程间的业务调用，如 `fonts:list`、`files:import-background-video` | [ipc](./ipc) 与 [preload](../preload)；频道名不是文件路径或 URL scheme        |

远程来源的协议能力集中声明于 [shared/remoteSources.ts](../shared/remoteSources.ts) 的 `REMOTE_PROTOCOLS`：

| 来源类型                                      | 地址协议                                  |
| --------------------------------------------- | ----------------------------------------- |
| `navidrome`、`subsonic`、`jellyfin`、`webdav` | `http:` / `https:`                        |
| `smb`                                         | `smb:` 或已挂载/映射的本地绝对路径        |
| `ftp`                                         | `ftp:`                                    |
| `ftps`、`ftps-implicit`                       | `ftps:`，两者由来源类型区分显式与隐式 TLS |
| `sftp`                                        | `sftp:`                                   |

这些来源由对应 provider 连接，不通过 `protocol.handle('easy-player-media', ...)` 转发远程音频。
来源验证与路径边界见 [service/nasProviders.ts](./service/nasProviders.ts)、[service/fileTransferProviders.ts](./service/fileTransferProviders.ts)
及 [service/remoteSourceService.ts](./service/remoteSourceService.ts)。

## 7. 修改时同步检查

1. 固定目录或资源文件发生变化：修改 `pathUtils` 对应 getter，并检查开发、打包两种布局及打包资源复制配置。
2. 新增启动时需要存在的目录：更新 `createDir()`；按需目录由对应业务创建。
3. 新增媒体资源类别：同步协议分支、允许目录、URL 编码、MIME、缓存及访问校验，不随应用显示名修改已有 scheme。
4. 修改路径 getter 接口：更新测试中的同名 mock；隔离测试仍使用 `EASY_PLAYER_DATA_DIR` 或自己的临时目录。
5. 修改主题资源或消息结构：同步包管理器、manifest 校验、iframe CSP 和渲染组件的来源检查。
