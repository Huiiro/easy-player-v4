export interface AutoMixRuntimeStatus {
  phase:
    | 'not-installed'
    | 'checking'
    | 'downloading'
    | 'installing'
    | 'uninstalling'
    | 'clearing-cache'
    | 'ready'
    | 'error'
  supported: boolean
  installed: boolean
  hasFiles?: boolean
  receivedBytes: number
  totalBytes: number
  version?: string
  error?: string
}

export interface AutoMixStemCacheInfo {
  directory: string
  bytes: number
  files: number
}

export interface AutoMixStemCacheResult {
  success: boolean
  data?: AutoMixStemCacheInfo
  error?: string
}

export interface AutoMixRuntimeManifest {
  formatVersion: 1
  version: string
  platform: 'win32'
  arch: 'x64'
  asset: string
  sha256: string
  size: number
  unpackedSize: number
}
