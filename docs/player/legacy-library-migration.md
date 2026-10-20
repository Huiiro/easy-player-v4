# 旧版本数据库一次性迁移

适用范围：`b0947bc3` 起使用数据库 V5、V6、V7、V8 的版本，迁移至当前 V1 完整基线。
全新安装无需执行。此工具不迁移更早的 V1–V4 播放记录格式，也不会转换 Windows 音乐文件路径。

1. 完全退出 Easy Player（包括托盘中的进程）。
2. 在当前源码目录安装依赖，使用 `.nvmrc` 指定的 Node 22.20.0。
3. 指定要迁移的数据库文件：

   ```sh
   npm run migrate:legacy -- "$HOME/Library/Application Support/easy-player/player_data/player.db"
   ```

   Windows PowerShell：

   ```powershell
   npm run migrate:legacy -- "$env:APPDATA/easy-player/player_data/player.db"
   ```

脚本使用项目 Electron 对应的 SQLite ABI，无需重新编译 better-sqlite3。
它先在原库旁创建 `player.db.backup-<UUID>.db`，备份包含已提交的 WAL 数据。
然后在单个事务内重建派生搜索表、填充原文搜索索引，并将数据库标记为当前基线。
歌曲、歌单、设置、来源和播放历史不变；拼音及日语读音索引会在下次启动时后台重建。
失败时事务回滚，备份保留；重复执行已完成的迁移不会修改数据库。

若需恢复，先完全退出应用，将当前 `player.db` 及其 `-wal`、`-shm` 文件移到其他目录保留，
再将备份复制为 `player.db`。恢复旧备份后，应使用对应旧版本应用或重新运行迁移。

该脚本需在源码环境运行，不是直接拖入已安装应用执行的工具。

## macOS 验证脚本

`check-player-app.cjs` 和 `check-playback-view.cjs` 使用 `EASY_PLAYER_DATA_DIR`
指定独立应用数据根目录；该目录下包含 `player_data`、`player_log`、`player_plugin`。
仅修改 Electron 的 `userData` 不会隔离音乐库。

```sh
npm run test:legacy-migration
npm run test:shortcuts
npm run build
npx electron scripts/check-playback-view.cjs
```
