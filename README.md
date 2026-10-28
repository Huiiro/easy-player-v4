# EasyPlayer

An Electron application with Vue and TypeScript

## 自定义主题开发

- [开发规范](docs/custom-themes.md)：主题格式、公开组件类、覆盖优先级、作用范围与验收流程。
- [变量参考](docs/theme-variables.md)：颜色、侧栏、按钮、进度条、弹层、底栏布局、歌词和动效的默认值与限制。
- [资源包规范](docs/theme-packages.md)：清单、图片与字体槽位、文字优先级、安装导入及安全边界。

## 应用数据目录

主进程与 Electron `userData` 统一使用 `easy_player` 根目录：

- Windows：`%APPDATA%/easy_player`
- macOS：`~/Library/Application Support/easy_player`
- Linux：`$XDG_CONFIG_HOME/easy_player`，未设置时为 `~/.config/easy_player`

数据库、设置、主题和缓存位于 `player_data`，插件位于 `player_plugin`，日志位于 `player_log`。
设置 `EASY_PLAYER_DATA_DIR` 可覆盖整个根目录（包含 Electron 会话数据），用于开发和测试隔离。
开发环境不自动迁移或删除旧目录，原有媒体协议保持不变。
主进程的固定目录和运行资源路径统一在 `src/main/utils/pathUtils.ts` 定义，业务模块使用对应 getter 获取。
新增数据子目录时，同时检查 `createDir()` 是否需要在启动时创建该目录。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
$ npm install
```

### Development

Upgrading a library from `b0947bc3` or later legacy V5–V8 databases:
see [the one-time migration guide](docs/player/legacy-library-migration.md).

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
