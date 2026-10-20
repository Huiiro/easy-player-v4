# easy-player

An Electron application with Vue and TypeScript

## 自定义主题开发

- [开发规范](docs/custom-themes.md)：主题格式、公开组件类、覆盖优先级、作用范围与验收流程。
- [变量参考](docs/theme-variables.md)：颜色、侧栏、按钮、进度条、弹层、底栏布局、歌词和动效的默认值与限制。
- [资源包规范](docs/theme-packages.md)：清单、图片与字体槽位、文字优先级、安装导入及安全边界。

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
