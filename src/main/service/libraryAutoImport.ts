import { BrowserWindow } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { MusicFolderWatcher } from './musicFolderWatcher'
import { scanMusicDirectory, SUPPORTED_EXTENSIONS } from './scanService'
import { isPlaybackOnly } from './playbackMode'
import { Logger } from './loggerService'
import { logError } from './operationLogger'
import type { LibraryAutoImportEvent } from '../../shared/libraryAutoImport'

const DIRECTORIES_KEY = 'library.autoImportDirectories'
const EXCLUDED_KEY = 'library.autoImportExcludedDirectories'
let directories: string[] = []
let enabled = true
let ignoreShortSongs = true
let watcher: MusicFolderWatcher | undefined

function savedDirectories(): string[] {
  const saved = getAppSetting(DIRECTORIES_KEY)
  return Array.isArray(saved)
    ? saved.filter((directory): directory is string => typeof directory === 'string')
    : (
        getDatabase()
          .prepare(
            "SELECT full_path FROM folder WHERE is_root_path = 1 AND full_path NOT LIKE 'remote://%'"
          )
          .all() as Array<{ full_path: string }>
      ).map((folder) => folder.full_path)
}

function containsDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
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
    directories = savedDirectories()
    // Folder reconstruction in old libraries can create drive roots; do not watch entire drives.
    directories = directories.filter(
      (directory) => path.resolve(directory) !== path.parse(path.resolve(directory)).root
    )
    watcher = new MusicFolderWatcher({
      extensions: SUPPORTED_EXTENSIONS,
      ignoredDirectories: (getAppSetting(EXCLUDED_KEY) as string[] | null) ?? [],
      isPaused: isPlaybackOnly,
      knownFiles: () =>
        new Set(
          (
            getDatabase().prepare('SELECT audio FROM song WHERE source_id IS NULL').all() as Array<{
              audio: string
            }>
          ).map((song) => song.audio)
        ),
      importFiles: async (root, files, active) => {
        const result = await scanMusicDirectory(root, undefined, files, ignoreShortSongs, {
          background: true,
          shouldContinue: active
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

/** Remember explicit folder imports, including empty directories, across app restarts. */
export function trackMusicDirectory(directory: string): void {
  directories = savedDirectories()
  const resolved = path.resolve(directory)
  const excluded = ((getAppSetting(EXCLUDED_KEY) as string[] | null) ?? []).filter((item) => {
    return !containsDirectory(resolved, item) && !containsDirectory(item, resolved)
  })
  setAppSetting(EXCLUDED_KEY, excluded)
  if (!directories.includes(resolved)) directories.push(resolved)
  setAppSetting(DIRECTORIES_KEY, directories)
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
