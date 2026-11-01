import { BrowserWindow } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { MusicFolderWatcher } from './musicFolderWatcher'
import { scanMusicDirectory, SUPPORTED_EXTENSIONS } from './scanService'
import { isPlaybackOnly } from './playbackMode'
import { Logger } from './loggerService'
import { logError } from './operationLogger'
import type { LibraryAutoImportEvent, LibraryWatchDirectory } from '../../shared/libraryAutoImport'
import { listAutoImportExclusions, isAutoImportExcluded } from '../database/repository/autoImport'

export { excludeAutoImportFiles } from '../database/repository/autoImport'

const EXCLUDED_KEY = 'library.autoImportExcludedDirectories'
const WATCHED_KEY = 'library.watchDirectories'
const REMOVED_KEY = 'library.removedWatchDirectories'
let enabled = false
let ignoreShortSongs = true
let watcher: MusicFolderWatcher | undefined

function containsDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function normalizeWatchDirectories(folders: LibraryWatchDirectory[]): LibraryWatchDirectory[] {
  const unique = new Map<string, LibraryWatchDirectory>()
  for (const folder of folders) {
    if (!folder || typeof folder.path !== 'string' || !path.isAbsolute(folder.path)) continue
    const resolved = path.resolve(folder.path)
    if (resolved === path.parse(resolved).root) continue
    unique.set(process.platform === 'win32' ? resolved.toLowerCase() : resolved, {
      path: resolved,
      enabled: folder.enabled === true
    })
  }
  return [...unique.values()]
}

export function getWatchedMusicDirectories(): LibraryWatchDirectory[] {
  const saved = getAppSetting(WATCHED_KEY)
  if (Array.isArray(saved)) return normalizeWatchDirectories(saved)
  const existing = getDatabase()
    .prepare(
      `
    SELECT f.full_path FROM folder f
    WHERE f.full_path NOT LIKE 'remote://%'
      AND (f.is_root_path = 1 OR EXISTS (
        SELECT 1 FROM song s WHERE s.folder_id = f.id AND s.source_id IS NULL
      ))
    ORDER BY f.full_path
  `
    )
    .all() as Array<{ full_path: string }>
  const candidates = normalizeWatchDirectories(
    existing.map((folder) => ({
      path: folder.full_path,
      enabled: true
    }))
  )
  // Existing roots cover their subfolders; drive roots are excluded by normalization.
  const folders = candidates.filter(
    (folder) =>
      !candidates.some(
        (parent) => parent.path !== folder.path && containsDirectory(parent.path, folder.path)
      )
  )
  setAppSetting(WATCHED_KEY, folders)
  return folders
}

export function setWatchedMusicDirectories(
  folders: LibraryWatchDirectory[]
): LibraryWatchDirectory[] {
  if (!Array.isArray(folders)) throw new Error('Invalid watched folders')
  const normalized = normalizeWatchDirectories(folders)
  const previous = getWatchedMusicDirectories()
  const removed = (getAppSetting(REMOVED_KEY) as string[] | null) ?? []
  setAppSetting(
    REMOVED_KEY,
    [
      ...new Set([
        ...removed,
        ...previous
          .filter(
            (old) => !normalized.some((folder) => path.relative(old.path, folder.path) === '')
          )
          .map((folder) => folder.path)
      ])
    ].filter(
      (directory) => !normalized.some((folder) => path.relative(directory, folder.path) === '')
    )
  )
  const restored = normalized.filter(
    (folder) => folder.enabled && !previous.some((old) => old.path === folder.path && old.enabled)
  )
  if (restored.length) {
    const excluded = ((getAppSetting(EXCLUDED_KEY) as string[] | null) ?? []).filter(
      (directory) =>
        !restored.some(
          (folder) =>
            containsDirectory(folder.path, directory) || containsDirectory(directory, folder.path)
        )
    )
    setAppSetting(EXCLUDED_KEY, excluded)
  }
  setAppSetting(WATCHED_KEY, normalized)
  stopLibraryAutoImport()
  if (enabled) configureLibraryAutoImport({ enabled, ignoreShortSongs })
  return normalized
}

export function configureLibraryAutoImport(settings: {
  enabled: boolean
  ignoreShortSongs: boolean
}): void {
  enabled = settings.enabled === true
  if (ignoreShortSongs !== (settings.ignoreShortSongs !== false)) stopLibraryAutoImport()
  ignoreShortSongs = settings.ignoreShortSongs !== false
  if (!enabled) {
    stopLibraryAutoImport()
    return
  }
  if (!watcher) {
    const watched = getWatchedMusicDirectories()
    const directories = watched.filter((folder) => folder.enabled).map((folder) => folder.path)
    watcher = new MusicFolderWatcher({
      extensions: SUPPORTED_EXTENSIONS,
      ignoredDirectories: (getAppSetting(EXCLUDED_KEY) as string[] | null) ?? [],
      disabledDirectories: watched
        .filter((folder) => !folder.enabled)
        .map((folder) => folder.path)
        .concat((getAppSetting(REMOVED_KEY) as string[] | null) ?? []),
      isPaused: isPlaybackOnly,
      knownFiles: () =>
        new Set(
          (
            getDatabase().prepare('SELECT audio FROM song WHERE source_id IS NULL').all() as Array<{
              audio: string
            }>
          )
            .map((song) => song.audio)
            .concat(listAutoImportExclusions())
        ),
      importFiles: async (root, files, active) => {
        const result = await scanMusicDirectory(root, undefined, files, ignoreShortSongs, {
          background: true,
          shouldContinue: active,
          shouldImportFile: (file) => !isAutoImportExcluded(file)
        })
        if (active() && result.added > 0) {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
              window.webContents.send('library:auto-imported', {
                directory: root,
                added: result.added
              } satisfies LibraryAutoImportEvent)
            }
          }
        }
        return result.added + result.duplicates + result.skipped === result.total
      },
      onError: (error, directory) =>
        Logger.warn('[Auto Import] directory update failed', { directory }, logError(error))
    })
    watcher.setDirectories(directories)
  }
}

/** Folder imports join monitoring unless the user has removed or disabled that scope. */
export function trackMusicDirectory(directory: string): void {
  const resolved = path.resolve(directory)
  const watched = getWatchedMusicDirectories()
  const removed = (getAppSetting(REMOVED_KEY) as string[] | null) ?? []
  const excludedByUser =
    removed.some((folder) => containsDirectory(folder, resolved)) ||
    watched.some((folder) => !folder.enabled && containsDirectory(folder.path, resolved))
  if (!excludedByUser && !watched.some((folder) => path.relative(folder.path, resolved) === '')) {
    setAppSetting(
      WATCHED_KEY,
      normalizeWatchDirectories([...watched, { path: resolved, enabled: true }])
    )
  }
  const excluded = ((getAppSetting(EXCLUDED_KEY) as string[] | null) ?? []).filter((item) => {
    return !containsDirectory(resolved, item) && !containsDirectory(item, resolved)
  })
  setAppSetting(EXCLUDED_KEY, excluded)
  if (enabled) {
    stopLibraryAutoImport()
    configureLibraryAutoImport({ enabled, ignoreShortSongs })
  }
}

/** Removing a library folder must not cause it to be immediately imported again. */
export function excludeMusicDirectory(directory: string): void {
  const excluded = (getAppSetting(EXCLUDED_KEY) as string[] | null) ?? []
  const resolved = path.resolve(directory)
  if (!excluded.includes(resolved)) excluded.push(resolved)
  setAppSetting(EXCLUDED_KEY, excluded)
  stopLibraryAutoImport()
  if (enabled) configureLibraryAutoImport({ enabled, ignoreShortSongs })
}

export function stopLibraryAutoImport(): void {
  watcher?.stop()
  watcher = undefined
}
