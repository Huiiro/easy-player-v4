# 3.3.0 发布前代码审查

审查日期：2026-10-30。范围：`822c0977..f720b0b`，34 个提交、486 个文件。重点核查插件加载与主题隔离、远程文件和凭据、歌词与元数据持久化、播放状态以及升级兼容性。本次仅修改版本和发布文档；以下代码问题尚未修复。

## P1：默认数据目录改名导致升级后无法读取旧数据

位置：`src/main/utils/pathUtils.ts:15`。

基线在 Windows/macOS 使用 `easy-player` 根目录，当前版本改为 `easy_player`；Linux 还改变了父目录。启动入口直接用新路径创建目录、打开数据库，没有探测或迁移基线目录。未设置 `EASY_PLAYER_DATA_DIR` 的现有用户升级后将看到空曲库、默认设置和缺失的歌单、历史及主题，原数据仍保留在旧目录，容易被误认为丢失。该行为也作用于发行包，不局限于开发模式。

复现：将基线与当前 `pathUtils.ts` 分别转译执行，固定 Windows APPDATA，结果从 `C:\fixture\AppData\Roaming\easy-player\player_data` 变为 `C:\fixture\AppData\Roaming\easy_player\player_data`。测试未访问真实用户目录。

建议：保留原有默认目录，或者在首次启动时提供完整、可回滚的目录迁移。迁移需覆盖数据库及 WAL、封面/主题等资源和数据库内的绝对路径，并处理新旧目录同时存在的情况。

## P1：新增数据库列未提供版本迁移

位置：`src/main/database/schema.ts:1`、`:67`、`:133`；`src/main/database/colors.ts:28`。

当前版本在建表 SQL 中新增 `song.offset_ms`、`disable_network_lyrics`、`instrumental` 和 `play_history.skip_feedback`，但 `DATABASE_SCHEMA_VERSION` 仍为 1，已有 V1 库会直接跳过迁移。歌曲通用查询已无条件读取新字段，推荐评分也读取 `skip_feedback`。因此复用旧库、设置数据目录覆盖或手动搬回旧库后，会发生 `no such column`，影响曲库查询、歌词和推荐。单纯修复上一个目录问题仍会触发本问题。

复现：在内存 SQLite 中执行 `822c0977` 的完整建表 SQL，写入 schema 版本 1，再调用当前真实 `migrate()`。确认三个歌曲字段仍不存在，查询 `offset_ms` 及 `skip_feedback` 均抛出缺列异常。复现脚本位于本地构建目录 `build/review-330-upgrade.cjs`（不纳入发布源码）。

建议：提升 schema 版本并增加事务化 `ALTER TABLE ... ADD COLUMN` 迁移，保留约束和默认值；以基线库验证升级和重复启动，断言歌曲、歌单、历史、设置和来源信息保留。仅提升版本后重新执行 `CREATE TABLE IF NOT EXISTS` 不能给已有表补列。

## 已完成的验证

- `npm run typecheck`：通过。
- `npm run build:nocheck`：通过；有插件模块同时静态/动态导入的构建提示，不影响此次构建。
- `node scripts/test-changelog.mjs`：通过；中英文版本及条目数量一致。
- 15 项现有回归脚本全部通过：`test-source-runtime`、`test-source-management`、`test-source-metadata`、`test-remote-sources`、`test-file-transfer`、`test-remote-source-storage`、`test-song-lyrics`、`test-lyric-editor`、`test-theme-plugins`、`test-plugin-logs`、`test-official-plugins`、`test-auto-mix-stems`、`test-download-audio`、`test-window-presentation`、`test-window-material`。
- 版本及双语更新日志格式检查通过；锁文件结构比较确认仅应用版本变化，依赖版本未变。
- 基线升级专项复现：上述两项风险均确认；现有回归通过不代表升级兼容性通过。

## 验证限制与发布建议

尝试重新编译 `auto_mix_test` 与 `audio_backend_recovery_test`，因本机缺少 `libavcodec/avcodec.h` 和 `libavutil/log.h` 失败，未运行旧二进制冒充当前源码验证。本次未生成安装包，也未完成跨平台安装升级、真实音频设备及主观听感验证。

建议修复两项 P1 问题后，再用基线用户数据完成安装升级验收，并在具备 FFmpeg 开发依赖的环境重跑原生测试。
