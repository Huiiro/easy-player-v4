# 远程文件与 NAS

远程文件页面统一管理以下连接。所有协议共用连接测试、曲库同步、歌曲索引和缓存播放流程。

| 协议 | 地址 | 认证 |
| --- | --- | --- |
| Navidrome | HTTP(S) 服务根地址 | 账号密码，使用 Subsonic 盐值 Token 请求 |
| Subsonic / OpenSubsonic | HTTP(S) 服务根地址 | 账号密码 |
| Jellyfin | HTTP(S) 服务根地址 | 账号密码或 API Key |
| WebDAV | 音乐目录 HTTP(S) 地址，如 `https://nas.example/dav/music/` | 匿名、HTTP Basic、Bearer Token |
| SMB 系统共享目录 | Windows：`smb://nas/music`、`\\nas\music` 或映射目录；其他系统：共享的绝对挂载目录 | 系统认证 |
| FTP | `ftp://nas:21/music/` | 账号密码、匿名 |
| FTPS（显式 TLS） | `ftps://nas:21/music/` | 账号密码、匿名 |
| FTPS（隐式 TLS） | `ftps://nas:990/music/` | 账号密码、匿名 |
| SFTP | `sftp://nas:22/music/` | 账号密码、SSH 私钥，支持加密私钥口令 |

连接表单根据协议自动展示允许的认证方式与字段。切换认证方式会清除上一个方式的凭据。URL 不接受内嵌账号、密码、查询参数或片段；端口和音乐根目录直接填写在 URL 中。

SMB 需要先在操作系统中连接共享，确保当前用户可以读取目录。应用通过系统文件接口访问共享，不内置 SMB 登录或挂载工具。SFTP 必须填写管理员提供的服务器 SHA256 公钥指纹，如 `SHA256:...`，不自动接受未知服务器；指纹不匹配时连接失败。FTPS 保持 TLS 证书验证，不回退到明文 FTP；自建 CA 需要由运行环境信任。

保存连接后可先测试，再同步曲库。NAS 协议递归索引音频文件，跳过非音频文件和可识别的符号链接。歌曲名称取自文件名，当前不扫描远端内嵌标签和封面。播放时按需下载到缓存目录，下载完成后交给现有播放器。

WebDAV 按 [RFC 4918](https://www.rfc-editor.org/rfc/rfc4918.html) 使用 `PROPFIND Depth: 0/1`，不依赖服务器的无限深度查询支持。HTTP 连接不跟随重定向，应填写最终地址。WebDAV 只接受配置目录内的资源，XML 响应上限 5 MiB；NAS 扫描最多处理 100,000 个条目。SMB 与 SFTP 读取文件时检查实际路径仍在配置根目录内。FTP 仅按根目录下相对路径读取，不允许父目录、绝对路径或命令换行注入。

## 统一模型与兼容

`src/shared/remoteSources.ts` 提供唯一协议能力目录、认证联合类型和连接 DTO：

```ts
interface RemoteConnection {
  type: RemoteProviderId
  baseUrl: string
  auth: RemoteAuth
  hostKey?: string // SFTP
}
```

`MusicSource` 在此基础上只增加 ID、名称、统计和凭据可用性状态。页面、预加载、IPC 和协议执行层共用该模型；旧的 `user/secret/authType/server` 仅存在于 SQLite 仓储兼容层，不再进入公开 DTO。协议契约位于 `src/main/service/remoteProvider.ts`，FTP/FTPS/SFTP 共用文件扫描和流生命周期实现。

读取旧 Navidrome、Jellyfin、WebDAV、SMB 记录时自动转换认证对象，保留来源 ID 与远端歌曲 ID，无需重建曲库。下一次保存时升级认证存储格式。现有表继续使用，完整认证对象（包括用户名、密码、Token、私钥和口令）通过系统密钥库加密后写入 `secret`，`auth_type` 标记版本和认证方式；SFTP 公开指纹存放在原 `server` 列。匿名和系统认证不保存秘密。切换为匿名认证会清除旧密文。密钥库不可用或密文损坏时返回错误状态，修改其他字段不会覆盖不可读密文；重新填写认证信息后可修复。

缓存名称由连接地址、认证用户名或方式、远端文件 ID 生成摘要，避免路径清洗碰撞。同一歌曲的并发请求复用下载，失败时清理临时文件；只清理应用命名的远程缓存，保留本次请求文件。

## 验证

`npm run test:remote-sources` 包含本地 WebDAV、FTP、显式/隐式 FTPS、SSH/SFTP 服务端与真实 SQLite 文件测试，覆盖目录递归、Unicode 文件名、下载、认证失败、Bearer/API Key、加密私钥、服务器身份、路径边界、同步、缓存、加密持久化、重启与旧记录转换。FTPS 测试通过子进程专用测试 CA 验证 TLS，不关闭证书校验。存储测试用模拟系统密钥库验证实际 SQLite 行，不访问用户系统凭据。

另运行 `npm run typecheck`、变更文件 ESLint 和 `npm run build:nocheck`。实际 NAS 厂商服务、网络与系统共享认证仍需在部署环境联调。
