# Easy Player Plugin SDK

`@easy-player/plugin-sdk@2.0.0` 提供纯契约与插件定义辅助函数，不依赖 Electron、应用数据库、UI、播放器状态或应用源码。

```sh
npm ci --ignore-scripts
npm run build
npm pack
```

发布给插件维护者的是包含 `dist/*.js` 和 `dist/*.d.ts` 的版本化 npm 包或 `.tgz`。[独立插件仓库](https://github.com/Huiiro/easy-player-plugin) 将该包固定在 `vendor/` 中；插件通过包名引用，不能引用 SDK 源码的相对路径。应用根命令 `npm run build:plugin-sdk` 生成 `build/` 下的 `.tgz`，再由插件仓库更新 vendor、依赖与锁文件。

API v2 的 `defineSourcePlugin(source, create, version)` 显式注册来源。`PluginHostContext` 提供网络、配置、日志、资源回收和可选的媒体信息查询能力。每次调用的 `SourceCallContext` 提供取消信号、截止时间和所属插件的宿主服务。播放器模式由宿主决定，不是插件全局状态。

`media.extractInfo` 只接受 URL 或查询及条数，返回 JSON 信息；宿主构建工具参数、负责进程和取消。插件不接收保存目录或任务、窗口身份。文件标签写入和数据库同步不在 SDK 中。

`SourceCallError` 仅携带稳定错误代码；应用负责本地化。SDK v2 的插件清单声明 API 2，旧应用应拒绝安装；新应用继续通过兼容桥接装载 API 1 的已发布包。来源能力的数据协议仍为 `NetworkSource.apiVersion = 1`。

修改公共契约时，先更新 SDK 版本并构建 `.tgz`，再更新插件项目的依赖和锁文件；应用兼容代码与插件源码分别维护。
