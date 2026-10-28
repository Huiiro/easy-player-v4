/** Protocol capabilities are the single source for validation and connection forms. */
export type RemoteAuth =
  | { type: 'anonymous' | 'system' }
  | { type: 'password' | 'basic'; username: string; password: string }
  | { type: 'bearer' | 'api-key'; token: string }
  | { type: 'private-key'; username: string; privateKey: string; passphrase?: string }
export type RemoteAuthType = RemoteAuth['type']
export interface RemoteProtocol {
  id: string
  label: string
  authTypes: readonly RemoteAuthType[]
  schemes: readonly string[]
  placeholder: string
}
export const REMOTE_PROTOCOLS = [
  {
    id: 'navidrome',
    label: 'Navidrome',
    authTypes: ['password'],
    schemes: ['http:', 'https:'],
    placeholder: 'https://music.example.com'
  },
  {
    id: 'subsonic',
    label: 'Subsonic / OpenSubsonic',
    authTypes: ['password'],
    schemes: ['http:', 'https:'],
    placeholder: 'https://music.example.com'
  },
  {
    id: 'jellyfin',
    label: 'Jellyfin',
    authTypes: ['password', 'api-key'],
    schemes: ['http:', 'https:'],
    placeholder: 'https://music.example.com'
  },
  {
    id: 'webdav',
    label: 'NAS · WebDAV',
    authTypes: ['basic', 'anonymous', 'bearer'],
    schemes: ['http:', 'https:'],
    placeholder: 'https://nas.example.com/dav/music/'
  },
  {
    id: 'smb',
    label: 'NAS · SMB',
    authTypes: ['system'],
    schemes: ['smb:'],
    placeholder: 'smb://nas/music'
  },
  {
    id: 'ftp',
    label: 'NAS · FTP',
    authTypes: ['password', 'anonymous'],
    schemes: ['ftp:'],
    placeholder: 'ftp://nas:21/music/'
  },
  {
    id: 'ftps',
    label: 'NAS · FTPS (TLS)',
    authTypes: ['password', 'anonymous'],
    schemes: ['ftps:'],
    placeholder: 'ftps://nas:21/music/'
  },
  {
    id: 'ftps-implicit',
    label: 'NAS · FTPS (implicit TLS)',
    authTypes: ['password', 'anonymous'],
    schemes: ['ftps:'],
    placeholder: 'ftps://nas:990/music/'
  },
  {
    id: 'sftp',
    label: 'NAS · SFTP',
    authTypes: ['password', 'private-key'],
    schemes: ['sftp:'],
    placeholder: 'sftp://nas:22/music/'
  }
] as const satisfies readonly RemoteProtocol[]
export type RemoteProviderId = (typeof REMOTE_PROTOCOLS)[number]['id']
export interface RemoteConnection {
  type: RemoteProviderId
  baseUrl: string
  auth: RemoteAuth
  /** SFTP server SHA-256 fingerprint, in OpenSSH SHA256:base64 format. */
  hostKey?: string
}
export function remoteProtocol(type: unknown): RemoteProtocol | undefined {
  return REMOTE_PROTOCOLS.find((protocol) => protocol.id === type)
}
export function isRemoteProviderId(value: unknown): value is RemoteProviderId {
  return !!remoteProtocol(value)
}
export function emptyRemoteAuth(type: RemoteAuthType): RemoteAuth {
  if (type === 'password' || type === 'basic') return { type, username: '', password: '' }
  if (type === 'bearer' || type === 'api-key') return { type, token: '' }
  if (type === 'private-key') return { type, username: '', privateKey: '', passphrase: '' }
  return { type }
}
/** Compatibility exists only at the boundary; providers consume RemoteConnection. */
export function normalizeRemoteConnection(value: unknown): RemoteConnection {
  if (!value || typeof value !== 'object') throw new Error('Invalid remote connection')
  const input = value as Record<string, unknown>
  const protocol = remoteProtocol(input.type)
  if (!protocol || typeof input.baseUrl !== 'string' || !input.baseUrl.trim())
    throw new Error('Invalid remote protocol or address')
  let auth = input.auth
  if (auth === undefined) {
    const type =
      input.authType ||
      (input.type === 'smb'
        ? 'system'
        : input.type === 'webdav'
          ? input.user || input.secret
            ? 'basic'
            : 'anonymous'
          : 'password')
    auth =
      type === 'anonymous' || type === 'system'
        ? { type }
        : type === 'api-key' || type === 'bearer'
          ? { type, token: input.secret || '' }
          : { type, username: input.user || '', password: input.secret || '' }
  }
  const result = {
    type: input.type,
    baseUrl: input.baseUrl.trim(),
    auth,
    hostKey: input.hostKey
  } as RemoteConnection
  if (!isRemoteConnection(result)) throw new Error('Invalid remote authentication or address')
  const selected = result.auth
  let normalized: RemoteAuth
  if (selected.type === 'password' || selected.type === 'basic')
    normalized = { type: selected.type, username: selected.username, password: selected.password }
  else if (selected.type === 'bearer' || selected.type === 'api-key')
    normalized = { type: selected.type, token: selected.token }
  else if (selected.type === 'private-key')
    normalized = {
      type: selected.type,
      username: selected.username,
      privateKey: selected.privateKey,
      passphrase: selected.passphrase
    }
  else normalized = { type: selected.type }
  return {
    type: result.type,
    baseUrl: result.baseUrl,
    auth: normalized,
    ...(result.type === 'sftp' ? { hostKey: result.hostKey } : {})
  }
}
export function isRemoteConnection(value: unknown): value is RemoteConnection {
  if (!value || typeof value !== 'object') return false
  const config = value as RemoteConnection
  const protocol = remoteProtocol(config.type)
  if (
    !protocol ||
    typeof config.baseUrl !== 'string' ||
    !config.baseUrl.trim() ||
    !config.auth ||
    !protocol.authTypes.includes(config.auth.type)
  )
    return false
  const auth = config.auth
  if (
    ['ftp', 'ftps', 'ftps-implicit'].includes(config.type) &&
    'password' in auth &&
    /[\r\n\0]/.test(auth.username + auth.password)
  )
    return false
  const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
  if (
    (auth.type === 'password' || auth.type === 'basic') &&
    (!text(auth.username) || typeof auth.password !== 'string' || !auth.password)
  )
    return false
  if (
    (auth.type === 'bearer' || auth.type === 'api-key') &&
    (!text(auth.token) || /[\r\n]/.test(auth.token))
  )
    return false
  if (auth.type === 'basic' && auth.username.includes(':')) return false
  if (
    auth.type === 'private-key' &&
    (!text(auth.username) ||
      !text(auth.privateKey) ||
      (auth.passphrase !== undefined && typeof auth.passphrase !== 'string'))
  )
    return false
  if (
    config.type === 'sftp' &&
    (typeof config.hostKey !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(config.hostKey))
  )
    return false
  if (config.type === 'smb' && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(config.baseUrl)) return true
  try {
    const url = new URL(config.baseUrl)
    if (
      !protocol.schemes.includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false
    const path = decodeURIComponent(url.pathname)
    if (/[\r\n\0\\]/.test(path) || path.split('/').includes('..')) return false
    return true
  } catch {
    return false
  }
}

/** Application DTO. Storage-only legacy fields never cross IPC. */
export interface MusicSource extends RemoteConnection {
  id: number
  name: string
  credentialError?: 'unavailable' | 'decrypt-failed' | 'invalid-config'
  status: string | null
  sourceOrder: number
  importedCount: number
  songCount: number
  lastConnect: string | null
}
export interface MusicSourceInput extends RemoteConnection {
  name: string
  status?: string | null
}
