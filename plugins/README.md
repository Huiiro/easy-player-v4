# 官方来源插件

官方插件与应用保存在同一个 GitHub 仓库 `Huiiro/easy-player-v4`，源码位于本目录，独立包通过该仓库的 `plugins` Release 分发。应用默认不附带、安装或请求任何来源插件。

## 目录与构建

- `official/netease`、`official/kugou`、`official/qqmusic`：歌词、封面、元数据来源。
- `official/media.ts`、`official/media/`：Bilibili 与 YouTube 下载来源。
- `sdk/`：插件定义辅助函数。API 类型位于应用的 `src/shared/plugins.ts`、`src/main/plugins/types.ts` 和 `src/main/sources/types.ts`。
- `shared/`：来源之间复用的流派映射。
- `catalog.json`：构建生成的轻量官方索引，可随应用提供离线浏览及本地包校验，不包含来源实现。

```sh
npm run build:plugins
npm run test:official-plugins
```

构建产物位于 `build/plugins/`，每个 `.epp` 是 ZIP 包，包含 `manifest.json`、独立的 `index.cjs` 和依赖许可证。平台 SDK 已包含在包内，插件只依赖 Node 内置模块及宿主桥接能力，无需访问应用的 `node_modules`。构建会拒绝遗漏的外部 npm 依赖；不启动 SDK 自带 HTTP 服务。

包的 ZIP 创建平台、权限和时间固定；许可证通过目录枚举匹配文件名，归一化大小写与换行，并按依赖版本分别保留。发布工作流会比较重建的索引与已提交索引，校验值不一致时停止发布，避免应用附带的离线索引指向不存在的包。

修改插件时通过入口的 `defineSourcePlugin(source, create, version)` 递增各自版本，然后重建、测试，将源码和新的 `catalog.json` 一同提交。默认的应用构建不会构建或安装这些插件。

## 安装与更新

设置 → 插件包含“已安装”和“官方源”。安装明确由用户触发；刷新官方源读取：

`https://github.com/Huiiro/easy-player-v4/releases/download/plugins/catalog.json`

目录只接受同仓库 `plugins` Release 中的 HTTPS 包地址。下载和本地导入均校验官方索引记录的 SHA-256、大小、完整 manifest 和 API 版本；本地导入不绕过官方目录校验。失败时保留现有索引及运行版本。

安装内容写入 `userData/plugins/<插件 ID>/<SHA-256>/`，`current.json` 是启动时恢复该插件的提交点。更新先检查包，再停止旧实例、加载新实例，最后原子切换指针；失败时恢复旧实例。插件启停与来源的独立偏好继续保存在现有设置中，不新增数据库表。

卸载删除安装指针并停止来源，保留配置。版本文件在下一次启动时清理，以便本次运行已经接纳的下载继续使用旧代码。损坏的包单独跳过并记录日志，不影响其他插件或本地播放。

## 发布

手动运行 GitHub Actions 的 **Publish official source plugins** 工作流。它构建、测试并发布 `.epp` 和 `catalog.json` 到同仓库的 `plugins` Release，先上传内容寻址的包，再替换索引。无需创建其他仓库或部署服务器；这不是应用版本发布工作流的一部分。

工作流首次运行前，线上索引与包地址可能不存在，应用仍能展示随版本提供的离线索引，并显示下载失败提示。本地开发可直接导入刚构建且与索引匹配的 `.epp`。

## 信任与能力边界

当前阶段仅支持可信官方插件：以应用固定的 GitHub 仓库 HTTPS 索引为信任来源，SHA-256 检查包完整性，**未配置独立签名密钥，也没有第三方沙箱**。官方插件在主进程运行，不接受任意 URL 或不在索引中的本地代码。第三方插件需要另行设计签名、权限与进程隔离。

平台适配和曲风数据属于插件；文件写入、数据库同步、下载任务、原生音频处理、通用下载工具与进程取消属于宿主。为兼容已有启停配置，`builtin.netease` 等历史插件 ID 保持稳定，界面及分发来源统一称为“官方插件”。
