export interface LibraryWatchDirectory {
  path: string
  enabled: boolean
}

export interface LibraryAutoImportEvent {
  directory: string
  added: number
}
