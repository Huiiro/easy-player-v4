# 网络来源与官方插件架构

当前应用默认不附带来源插件。五个官方来源已移至同仓库 plugins/official，通过独立包按需安装、装载和管理；官方分发使用 Huiiro/easy-player-v4 的 plugins Release。尚不支持不受信任的第三方代码，也不涉及流媒体播放。下方保留各阶段的实现边界和验证记录，旧阶段的目录以第八阶段为准。

## 边界与目录

- src/shared/networkSources.ts：可序列化的数据契约，统一服务商资源引用、歌词、封面、媒体搜索结果与下载计划。
- src/main/sources/types.ts：NetworkSource 按能力提供 lyrics、artwork、metadata、download；没有实现的能力不注册。
- src/main/sources/registry.ts：注册、注销、能力查询和 URL 来源匹配。注册重复 ID 会失败，旧注销回调不会删除新注册实例。
- src/main/sources/index.ts：保留 getNetworkSources 兼容入口，实际注册由 plugins/runtime.ts 和官方插件管理器持有。网易云、酷狗、QQ 音乐提供歌词、封面和元数据；B 站和 YouTube 提供媒体搜索、解析与下载资源解析。
- plugins/official：各平台插件入口、歌词、封面、元数据和媒体资源解析。
- plugins/shared：来源流派归一化及平台字典。
- src/main/plugins/packages.ts：官方目录、包完整性与兼容性校验、安装/更新事务、重启恢复及卸载。
- src/main/service/mediaDownloadService.ts：宿主下载入口与 HTTP、yt-dlp 执行器。
- src/main/service/mediaDownloadRuntime.ts：宿主网络请求、外部进程和图片获取工具，保留轻量模式中断。

服务商 ID 继续使用 netease、kugou、qqmusic、bili、youtube。资源引用包含 sourceId、resourceType、resourceId，可选 subId：歌词结果引用平台曲目 ID（酷狗优先 MixSongID，兼容旧歌曲 hash），封面引用专辑 ID，B 站分 P 使用 BV ID + cid。候选歌词 ID 和曲目资源 ID 分离，切换歌词格式不会改变资源关联。

## 调用与写入

歌词：原 IPC → network.ts → 注册表中的 lyrics.search → 宿主附加来源身份、过滤、格式回退和排序 → 原解析/显示/保存路径。前端使用共享 DTO，并为新增来源提供动态名称回退。插件不访问歌词数据库；本阶段不改变自动保存和手动保存策略。

封面：原 metadata IPC → artwork.ts → 注册表中的 artwork.search → 宿主获取预览和写入。服务商仅返回资源描述；单个来源失败不影响其他来源，全部失败时仍返回错误。

下载：原 media-download IPC → 来源的 download.search / parse → 下载入口调用 download.resolve → 宿主执行计划。Provider 收到 URL、资源 ID、类型和质量，不接收保存目录、窗口或任务身份。

下载计划是内存中的内部数据，可能含短期 URL 和请求头，不暴露给界面，也不写入下载历史。

- http：来源返回媒体 URL、请求头、扩展名、可选封面和音频收尾标志。宿主负责临时目录、进度、文件落盘、封装/元数据校验、发布最终文件和历史记录。
- yt-dlp：来源返回页面地址、媒体类型和质量；宿主选择工具并构建参数，不接受 Provider 提供任意 shell 命令。

原 IPC 通道、进度事件、历史数据库字段和下载页面保持兼容。platform 作为来源 ID 的兼容字段保留，不进行数据库迁移。URL 按已注册域名路由，不再将未知站点自动当作 YouTube；新增站点需要明确适配。

## 已统一和后续范围

已统一来源注册、资源引用、媒体搜索/解析接口、下载入口和执行器分派。B 站的音频封装、封面嵌入、截断检测和失败清理保持原行为；YouTube 保留 yt-dlp 参数与进度处理。

尚未增加任务队列、手动取消/重试、断点续传、统一失败历史或自动入库。B 站沿用现有最高带宽选择，质量档位尚未映射至平台能力。封面预览与媒体任务共享来源体系，暂不强行纳入同一种任务队列。远程曲库缓存继续走原流程。

现已接入网易云 metadata 能力；后续增加 auth 能力，并建立按 sourceId/accountId 隔离的认证上下文，当前不宣称具备登录能力。统一调用层已补充超时和取消；开放第三方前仍需完成完整返回数据限制、宿主权限校验与受限执行环境，当前进程内接口本身不构成权限边界。

## 验证

- npm run typecheck
- npm run test:network-sources
- npm run test:download-audio
- npm run test:playback-mode

下载测试通过模拟平台响应与进程验证真实的新模块调用链和文件写入，不依赖在线账号；真实平台网络和外部工具联调仍需单独执行。

## 第二阶段：网易云曲目匹配与确认写入

入口为歌曲菜单 → 编辑元数据 → 网络匹配。先选择网络曲目版本，再查看差异并逐项勾选，搜索、查看详情和获取资源都不会自动写入。

- metadata.search 返回统一曲目资源引用；metadata.get 使用同一 ID 获取详情，专辑查询仅作可降级补充。
- 标题、歌手、专辑、专辑歌手、流派、年份、音轨号和碟片号按平台实际提供情况映射，缺失字段不生成清空操作。完整发行日期仅展示，当前可写字段为年份。
- 详情附带同一曲目的封面描述；lyrics.get 按该曲目 ID 获取歌词，避免再次关键词搜索。元数据编辑使用逐行 LRC，逐字歌词管理仍走原歌词入口。
- src/shared/sourceMetadata.ts 统一搜索详情、字段白名单和文件版本令牌；src/main/service/metadataWriteService.ts 集中处理原手工编辑和网络候选写入。
- 勾选字段直接写入音频文件，成功后回读标签并同步这些字段到曲库。专辑歌手也写入文件；曲库暂无对应列。失败不会先更新曲库。
- 对音频文件建立快照，写入前核对标签、文件大小、修改时间和封面摘要，并对同一歌曲串行处理写入。外部修改后旧候选会被拒绝，需要重新打开匹配窗口。
- 替换歌词时同时清除原翻译和音译，避免旧内容错配；替换封面时使颜色分析缓存失效。保存会通知正在显示的歌词重新加载，歌词读取仍遵循现有来源优先级。
- 网络匹配只保存该窗口勾选字段，不保存外层元数据编辑器中其他未确认修改。当前不持久化本地歌曲与服务商资源的关联。

验证：npm run test:source-metadata 使用模拟 SDK、真实 SQLite 和前端异步状态测试；npm run test:source-metadata:ui 在构建后运行真实 Electron DOM 检查，覆盖直接写入、明确选择、资源复用与窄窗口布局，预览位于 build/source-metadata-dialog.png。

文件写入和 SQLite 更新不是跨资源事务；文件写入成功后若读回或数据库同步失败，会报告失败，用户可用现有从文件重载功能恢复同步。

本阶段另以公开曲目执行过真实网易云搜索、曲目详情和专辑详情联调，均返回成功；登录态、付费资源及其他账号权限尚未验证。

## 文件写入与重新载入

Windows 解码器以允许删除/重命名共享的只读句柄读取音频，标签写入通过 ReplaceFileW 发布完整的新文件；当前解码器继续读取原句柄，后续打开读取新标签。失败不删除原文件，并把实际错误传回界面。此改动需要完整重启应用才能加载新原生模块。

保存和重新载入均以音频文件标签为准，不使用元数据覆盖表，也不提供仅更新曲库的保存分支。保留 V2 版本号作为兼容标记，不新增表；已有旧表不再读取或写入。此前只保存在数据库的修改不会自动写进音频文件，需要用户重新确认所选字段。

写入前由主进程核对真实播放引擎的已加载文件路径；匹配时直接跳过并保留编辑窗口与所选字段，提示切歌后重试。暂停、就绪或停止后仍持有解码器句柄的文件同样跳过。封面预处理和格式探测后、真正写入前再次检查；其他程序造成的 Windows 共享冲突（32/33）显示文件占用提示，本次不更新曲库。当前不建立延后写入队列。

网络匹配界面使用 BaseDialog、BaseSelect、BaseInput、BaseButton 和 useMessage；读取、搜索、详情、歌词、封面和保存失败均保留窗口内错误，并提供全局消息。字段表头支持全选、半选和取消全选，并显示已选数量；只选择当前已获取的差异字段，新获取的歌词或封面仍需确认。保存失败保留原勾选项以便重试。

网易云流派通过同一曲目 ID 的 song_wiki_summary 补充，仅提取 SONG_PLAY_ABOUT_SONG_BASIC 中 songTag 下的 melody_style，不混入 songBizTag 推荐标签、语种、BPM 或歌单分类；多个曲风去重后保存在现有 genre 字段。百科和专辑补充并行且允许失败，缺失流派不生成清空操作。

网络候选流派在展示前通过 genreNormalization.ts 统一名称，网易云 /style/list 的中英文曲风名作为本地映射快照（2026-10-24），匹配时不额外请求分类列表。项目固定拼写为 Jpop / Kpop / Cpop / Tpop，保留父子结构，如“流行-日本流行”→“Pop-Jpop”；多个候选转换后去重，未知名称保留原文。仅作用于网络匹配结果及确认后的写入，不批量修改已有文件或曲库原始标签。

## 第三阶段：内置服务商管理

设置 → 网络来源展示已注册服务商的名称、适配器版本、实际能力和启用状态。能力从已注册实现派生，不宣称未实现的登录或播放能力。预加载仅暴露可序列化描述和设置操作。

启停保存到已有 app_setting 的 network-sources.disabled 数组；缺省全部启用，启动时恢复，不新增数据库表。保存成功后才更新运行状态并通知窗口，持久化失败保留原状态。来源注册、注销和启停分离，停用的来源仍可在管理中重新开启。

注册表 list() 只返回已启用来源，listAll() 用于管理。元数据搜索、详情和精确歌词使用 requireEnabled；歌词聚合与封面搜索只遍历启用项，下载搜索、URL 路由和任务创建也在主进程拦截停用来源。第三阶段最初保留在途调用；第四阶段起，停用会中断该来源的搜索、详情和歌词调用，已经接受的下载任务继续执行。

下载页由已启用的 download 能力生成来源选项，保留当前选择；全部停用时提示并禁用搜索。设置变更同步刷新设置与下载页，旧结果不能绕过主进程校验。网络匹配在打开时读取已启用的元数据来源。

验证：npm run test:source-management 覆盖真实 SQLite 持久化、重启恢复、能力拦截、URL 路由、失败回滚及 IPC；npm run test:source-management:ui 覆盖真实 Electron 的加载/保存失败、开关状态、下载联动、空状态、窄窗口及订阅清理。

## 第四阶段：统一调用、超时与取消

runtime.ts 为各能力建立调用上下文（signal、deadline、sourceId、operation），统一校验启用状态、能力和基础返回形状，处理超时、轻量模式切换及来源停用。每个调用在结束后清理计时器和监听；忽略 AbortSignal 的 SDK 也不会阻塞宿主返回，迟到的异常仍有处理器。

预加载的元数据搜索/详情、精确歌词、封面搜索/获取、歌词聚合、媒体搜索/解析统一走 network-sources:invoke，返回可序列化的 success/data/error/failure。failure 包含 code、message、retryable、sourceId 和 operation；下载旧 API 保持返回数组及抛出错误的形状。旧 IPC 保留兼容并复用相同能力包装；文件写入与本地快照接口保持独立。

超时按单次能力调用计算，格式回退共享同一个来源调用的期限；封面搜索后的图片获取另计。renderer 不能指定超时时长。

| 操作                          | 默认时限      |
| ----------------------------- | ------------- |
| 元数据搜索 / 曲目详情         | 15 秒 / 25 秒 |
| 歌词聚合（每来源）/ 精确歌词  | 20 秒 / 15 秒 |
| 封面搜索 / 图片获取           | 15 秒 / 20 秒 |
| 媒体搜索或解析 / 下载资源解析 | 60 秒 / 30 秒 |

renderer 仅传递纯数据 requestId，通过 network-sources:cancel 取消；AbortSignal 和本地 isCurrent 回调不跨 IPC。主进程按发起窗口隔离请求，相同 ID 可供不同窗口使用，一个窗口不能取消另一个窗口的请求。窗口销毁会取消所属调用；单窗口最多同时登记 64 个请求。

网络匹配、歌词管理和下载搜索支持取消按钮；关闭弹窗、切换歌曲或来源、替换请求时取消旧调用并丢弃迟到结果。封面编辑也有过期结果保护。自动歌词解析在切歌/卸载时取消，迟到的歌词不会自动写入曲库。用户主动取消不作为错误提示或空结果展示，其他失败保留原因供重试。

QQ 的 fetch、B 站 HTTP 和图片 fetch 可中断网络请求；yt-dlp 搜索/解析取消时终止该任务的进程（Windows 隐藏运行 taskkill，仅针对持有的 PID 及其子进程）。网易云和酷狗 SDK 当前不提供 socket 级取消，这两者采用宿主及时返回、忽略迟到结果、停止后续 API 调用的方式。文件写入不接受取消，以免中途发布不完整结果；已接受下载任务由宿主继续完成，搜索取消不等于下载任务取消。

统一错误覆盖 TIMEOUT、CANCELLED、SOURCE_DISABLED、SOURCE_NOT_FOUND、UNSUPPORTED_CAPABILITY、NETWORK、AUTH_REQUIRED、RATE_LIMITED、RESOURCE_NOT_FOUND、INVALID_RESPONSE、INVALID_REQUEST、BACKGROUND_PAUSED、PROVIDER_ERROR。HTTP 401/403 表示拒绝访问，不推断平台已提供登录流程。单个来源或候选失败仍允许其他结果返回，全部调用失败时报告原因；可选专辑/百科补充继续允许降级。没有新增自动重试，避免重复请求和放大限流。

调用日志只记录来源、操作、耗时和规范化错误，不包含搜索词、原始异常响应或鉴权头。封面获取在流式读取时限制为 20 MiB。

验证：npm run test:source-runtime 覆盖超时、主动取消、迟到异常、停用/轻量模式中断、错误分类、IPC 窗口归属与清理、SDK 停止后续调用、真实预加载 DTO 和自动歌词禁止迟到写入。test:source-metadata:ui 增加取消、迟到结果、超时提示和重试检查。平台网络与账号权限仍需真实环境联调。

## 第五阶段：酷狗元数据与精确资源接入

酷狗现在注册 metadata.search / metadata.get、artwork.search 和 lyrics.get，复用现有来源选择、字段差异、明确勾选与文件写入流程。网络匹配窗口使用与来源设置一致的本地化名称。没有新增数据库表、登录入口或播放能力。

曲目搜索使用 SDK search，展开返回的 Grp 版本并按 MixSongID 去重；标题保留 Suffix（如 Live），时长由秒转换为毫秒。元数据资源 ID 使用专辑维度的 MixSongID / album_audio_id，避免同名歌曲或相同音频出现在不同专辑时混用版本。缺少有效 ID 的条目不进入候选列表。

曲目详情通过 krm_audio 按同一 ID 获取，并检查响应中的 base.album_audio_id 确实匹配。映射标题、歌手、专辑、发行日期/年份、extra.sort 音轨号、extra.disc 碟片号及 audio_info.timelength 时长；专辑歌手由匹配 album_id 的 album_detail 补充，失败保留曲目自身的信息。缺失、无效或零值字段保持缺失，不产生清空标签操作。接口字段参考 [SDK 上游文档](https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md)。

流派仅取已验证响应中 pid=3 曲风树的后代，依父子链保留最细分支，不混入语种、心情、场景和运营标签。处理重名 ID、无效/未发布节点和循环，沿用统一流派映射；国语流行与华语流行归一为 Cpop，已知中英文别名统一，未知曲风保留原名。例如可得到 Pop-Cpop、R&B-Contemporary R&B。

封面描述优先使用曲目 album_info.cover，专辑详情为可选补充；搜索封面直接使用搜索返回的图片，按 URL 去重、最多 12 个，避免逐项请求详情。模板 {size} 展开为 500 并使用 HTTPS，图片下载、预览及写入仍由宿主处理。

lyrics.get 先按所选 MixSongID 查询该版本的 audio_info.hash，再携带 hash 和 album_audio_id 调用 search_lyric，随后按候选 id/accesskey 获取 LRC 或 KRC，不通过关键词重新匹配。仅传 album_audio_id 会被当前歌词接口拒绝，因此不可省略 hash。歌词聚合候选优先返回 MixSongID，已有 hash 形式资源引用仍可获取。歌词 API 的成功响应可能为 status=200 / errcode=200，与搜索/元数据的 status=1 / error_code=0 分开识别。

仍采用上一阶段的宿主逻辑取消和 SDK 后续调用检查。可选专辑失败允许降级；详情 ID 不匹配、错误响应和接口拒绝通过统一错误层返回。暂不提供登录，使用现有公开请求上下文；需要鉴权或限流时保留明确错误。

验证：npm run test:kugou-source 使用与实际响应结构一致的合成数据，覆盖录音室/现场版、字段与流派、专辑降级、精确歌词、旧 hash 引用、封面、错误分类、停用及取消。test:source-metadata:ui 增加酷狗选择和资源来源保持检查；原文件写入与下载回归继续通过。

2026-10-24 使用真实 SDK 对公开曲目的录音室版（32100650）与现场版（68426443）执行搜索、详情、专辑、精确 LRC 及封面候选联调，均成功。只读验证，没有写入用户音频文件；未来平台变化和账号权限需继续实际验证。

## 第六阶段：QQ 音乐元数据与精确资源接入

QQ 音乐现在注册 metadata.search / metadata.get、artwork.search 和 lyrics.get，成为第三个元数据来源，复用来源管理、差异勾选、取消请求和文件写入。没有新增登录、下载或流媒体播放能力。

qqmusicShared.ts 集中处理已有歌词和新增元数据的 HTTP/JSONP、musicu RPC 信封、错误检查、搜索及按 MID 查曲目。主搜索沿用已验证的 DoSearchForQQMusicDesktop 请求，失败时保留旧搜索接口回退；明确 HTTP/RPC 401、403、429 时不继续请求另一搜索入口，合法空列表直接返回。每个 fetch 最长 6 秒并合并宿主 AbortSignal，取消会中断真实 HTTP 请求及后续回退。

资源 ID 采用 14 位字母数字 song MID，详情使用 music.pf_song_detail_svr / get_song_detail_yqq，并检查返回 track_info.mid 与请求一致。实现参考 [接口维护者的曲目请求源码](https://github.com/jsososo/QQMusicApi/blob/master/routes/song.js)，最终映射以实际响应为准。搜索展开 grp 版本、按 MID 去重；标题优先 title，避免 name 只有歌名时丢失 Live 等版本标识。interval 秒转换为毫秒，index_album 为音轨号，存在的零基 index_cd 转为一基碟片号，缺失字段保持缺失。

曲目流派只读取 info.genre.content[].value 并沿用统一归一化与去重。数字 track_info.genre 不转换为文本；语种、简介、专辑整体曲风（例如 genreNew）不替代具体曲目的流派。QQ 只返回 Pop 时保留 Pop，不根据国语等语种推断 Cpop。

可选专辑补充使用 music.musichallAlbum.AlbumInfoServer / GetAlbumDetail，参数为 albumMId；核对 basicInfo.albumMid 后使用 singer.singerList 作为专辑歌手，专辑返回失败或 ID 不符时保留曲目已有信息。发行日期优先曲目/曲目专辑字段及明确的发行时间描述，专辑日期作最后补充。

封面由 album MID 和匹配该 MID 的可选 pmid 修订号构建 QQ 图片地址；封面搜索直接复用曲目搜索描述、按地址去重并限制为 12 个，不逐曲请求详情。图片下载、预览和标签写入继续由宿主处理。

精确歌词先查同一 MID 的详情，再复用现有逐行 LRC 或 QRC 请求；QRC 使用该曲目的数字 songID，转换为现有 YRC 内部格式。选择曲目后不再发起关键词搜索，翻译和音译保持原解析行为。RPC 业务错误与 HTTP 失败进入统一错误层，无有效歌词返回空值，原自动搜索的格式回退继续保留。

验证：npm run test:qqmusic-source 覆盖 MID 校验、版本标题、分组去重、旧搜索回退、字段与流派、专辑失败/错配、精确 LRC/QRC、封面修订号、业务错误、空结果、停用与真实 fetch signal 的取消。test:source-metadata:ui 验证三来源选择和 QQ 资源身份保持；酷狗、来源管理、原歌词、文件写入及下载回归通过。

2026-10-24 对公开曲目录音室版（0039MnYb0qxYhV）与现场版（001398Rf3gykz8）完成实际搜索、详情、专辑及精确 LRC 联调；两个专辑封面地址均返回 HTTP 200 / image/jpeg。一次初始联调遇到临时 HTTP 500，后续逐步验证均通过；未添加自动重试或假成功回退。在线验证没有写入用户音频文件，QRC 转换由合成加密数据回归覆盖。

## 第七阶段：完整的内置插件生命周期

五个内置来源现在分别由 builtin.netease、builtin.kugou、builtin.qqmusic、builtin.bili、builtin.youtube 插件声明和注册。来源 ID 仍为 netease、kugou、qqmusic、bili、youtube，旧资源引用、来源设置和下载历史继续兼容。插件与来源不是同一个模型：PluginManifest 可声明多个来源，也可暂不提供来源，不限定一插件一来源。

- src/shared/plugins.ts：插件清单、来源贡献、版本、API v1、运行状态及失败代码，均为可序列化 DTO。
- src/main/plugins/builtin：五个可信内置入口；当前与应用一起编译，沿用已有适配器实现。
- src/main/plugins/manager.ts：清单和版本校验、贡献 ID 所有权、同步激活、原子注册、失败回滚、停用、卸载、重试及退出清理。
- src/main/plugins/runtime.ts：延迟建立内置目录，兼容原来源注册表访问。单个清单或激活失败不阻止其他有效插件注册。
- src/main/plugins/management.ts 与 ipc/pluginIpcHandlers.ts：恢复启停设置、持久化、管理 IPC 及跨窗口通知。
- src/renderer/src/components/settings/BuiltinPluginSettings.vue：设置 → 插件，展示版本、能力和实际状态，支持启停、失败原因和重试启动。

装载先校验清单和预留贡献 ID，激活时暂存来源，所有声明的来源均有效注册后才公开。重复插件、来源冲突、未声明贡献、能力不符、缺失方法、API 版本不兼容和不支持的异步入口都会被拒绝。一次激活失败只清理该插件本次拥有的资源，其他插件保持可用。

状态为 inactive、activating、active、deactivating、failed。当前可信内置 API v1 的 activate、deactivate 和清理回调均为同步契约；异步网络工作在能力调用中执行。异步生命周期返回不会被当成完成，也会附加异常处理器避免迟到异常成为未处理拒绝。停用先中断生命周期信号，再执行退出钩子并按逆序清理全部已登记资源；一个清理回调失败不会跳过其他清理，失败状态会保留。应用显式退出和 will-quit 都在关闭数据库前执行幂等卸载。

PluginHostContext 提供 registerSource、own、生命周期 signal、受控 HTTP、带插件身份的日志以及独立 JSON 配置。配置存放于已有 app_setting 的 plugins.data.<pluginId>:<key>，插件 ID 和配置键不允许冒号，避免不同命名空间拼接冲突；数据复制、JSON 校验和单值 64 KiB 限制在宿主完成。旧上下文在停止后失效。此配置接口不是凭据保险库。

来源注册表记录贡献所有者及每次注册的生命周期信号，公开描述包含 pluginId / pluginState。停用后真正注销运行中的实现，清单中的来源仍可展示为不可用。单个来源主动释放也取消自身在途调用；旧注销回调不会删除重新激活后的新实现。QQ 的 HTTP 路径已使用调用上下文中的宿主网络服务，直接适配器测试保留无宿主时的回退；网易云/酷狗 SDK 仍沿用已有平台适配实现和逻辑取消检查。内置兼容适配器仍在宿主代码树中，这一阶段不宣称是可独立分发的第三方插件包或隔离运行环境。

已接纳的 download.resolve 在调用入口取得原实现和宿主颁发的临时许可，可在插件停止后完成资源解析；许可在调用结束时释放。普通调用、伪造或过期的解析上下文不能通过已关闭的插件上下文继续发 HTTP。停止插件不取消已开始的宿主下载，新的搜索、解析和任务创建仍受主进程状态校验。

插件启停保存到 plugins.disabled，来源自身启停继续使用 network-sources.disabled。插件停用不覆盖来源偏好；重新启动恢复原来源选择。停用前持久化失败保持插件运行；新激活后的持久化失败会回滚本次激活。启动失败可独立重试，清理失败有可见状态。管理事件同时广播 plugins:changed 和 network-sources:changed，来源设置与下载页同步更新；插件未运行时来源开关显示原因，不能绕过主进程重新启用。旧数据库无需新增表。

验证：npm run test:builtin-plugins 覆盖多来源插件、真实五插件目录、清单校验、激活原子性、所有权、失败与重试、清理失败隔离、过期上下文、来源偏好、宿主网络取消、下载许可、真实 SQLite 重启/持久化回滚、IPC、真实预加载 DTO 和退出清理。test:source-management:ui 现在额外覆盖真实 Electron 中的插件加载/保存失败、启动失败与重试、来源偏好保留、下载选项联动及订阅释放；预览为 build/builtin-plugins-settings.png。原三平台元数据、歌词、文件写入和下载回归继续通过。


## 第八阶段：同仓库官方分发与默认空应用

应用运行时不再静态导入任何来源。平台代码已迁至 plugins/official，网易云、酷狗及 QRC SDK 改为开发依赖，随插件独立打包；electron-builder 排除 plugins 和 scripts 目录。应用只携带轻量官方索引以支持离线浏览、包校验，本地播放器、文件写入、下载任务和通用下载工具继续由宿主负责。

设置 → 插件区分“已安装”和“官方源”，提供手动安装、更新、导入本地包、停用、重试与卸载。启动不会刷新索引或下载插件。旧插件 ID 保留以继承插件与来源的独立设置，卸载后设置保留。

官方目录固定为同一 GitHub 仓库的 plugins Release。每个包使用内容寻址的文件名，校验大小、SHA-256、manifest/API、路径和展开大小，只写入固定运行文件，不执行通用 ZIP 解压。官方索引为固定仓库 HTTPS 信任来源，当前未配置独立签名，不提供第三方沙箱。

安装先验证新包，激活成功后原子切换 current.json；激活/持久化失败恢复旧实例与启动指针，不允许退回更旧版本。并发安装和卸载互斥。更新/卸载不打断已接纳的下载；无安装指针或不再使用的版本目录在下次启动时清理。损坏包独立跳过并记录日志。

构建及维护说明见 [plugins/README.md](../../plugins/README.md)。手动 GitHub Actions 工作流 .github/workflows/plugins.yml 构建并验证插件，先发布包，再发布目录；本地实现不触发远程发布。

验证：build:plugins 生成五个无外部 npm 依赖的包；test:official-plugins 覆盖默认无插件、实际独立包调用、安装/重启/本地导入、完整性、更新回滚、卸载、损坏隔离与离线目录；test:source-management:ui 覆盖官方目录、刷新与安装失败、安装/卸载联动、空状态、窄窗口和订阅释放。其余来源、歌词、元数据文件写入与下载回归保留。
