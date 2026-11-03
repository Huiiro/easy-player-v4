import { app, type BrowserWindow } from 'electron'
import sharp from 'sharp'
import { getSystemMediaAddonPath } from '../utils/pathUtils'
import { Logger } from './loggerService'
import type {
  SystemMediaAction,
  SystemMediaControlsState,
  SystemMediaPlaybackState,
  SystemMediaSnapshot,
  SystemMediaTrack
} from '../../shared/systemMediaControls'

export interface SystemMediaSession {
  ready(): Promise<void>
  update(snapshot: SystemMediaSnapshot): Promise<void>
  artwork(bytes: Buffer, revision: number): Promise<void>
  close(): Promise<void>
}

export function createSystemMediaControls(options: {
  platform: string
  fallbackCover: string
  onAction(action: SystemMediaAction): void
  readEnabled(): unknown
  writeEnabled(enabled: boolean): void
  createSession?: (
    handle: Buffer,
    onAction: (action: SystemMediaAction) => void
  ) => SystemMediaSession
  readArtwork?: (source: string) => Promise<Buffer>
}): {
  attach(window: BrowserWindow): Promise<void>
  updateTrack(track: SystemMediaTrack | null, state: SystemMediaPlaybackState): void
  updatePlayback(state: SystemMediaPlaybackState): void
  state(): SystemMediaControlsState
  setEnabled(enabled: boolean): Promise<SystemMediaControlsState>
  dispose(): Promise<void>
} {
  let session: SystemMediaSession | undefined
  let boundWindow: BrowserWindow | undefined
  let available = false
  let enabled = true
  let disposed = false
  let generation = 0
  let revision = 0
  let track: SystemMediaTrack | null = null
  let status: SystemMediaPlaybackState = 'idle'
  let lastPublished = ''
  let artworkRevision = -1
  let operations: Promise<unknown> = Promise.resolve()
  const warn = (reason: unknown): void =>
    Logger.warn('[SMTC] System media controls unavailable', reason)
  const create =
    options.createSession ??
    ((handle, onAction) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const binding = require(getSystemMediaAddonPath(app.isPackaged)) as {
        Session: new (
          handle: Buffer,
          onAction: (action: SystemMediaAction) => void
        ) => SystemMediaSession
      }
      return new binding.Session(handle, onAction)
    })
  const readArtwork =
    options.readArtwork ??
    (async (source: string) =>
      sharp(source, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#111614' })
        .jpeg({ quality: 85 })
        .toBuffer())

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = operations.then(operation)
    operations = next.catch(() => {})
    return next
  }
  function state(): SystemMediaControlsState {
    return { available, enabled }
  }
  function snapshot(): SystemMediaSnapshot {
    return {
      revision,
      enabled,
      hasTrack: !!track,
      title: track?.title || '',
      artist: track?.artist || '',
      album: track?.album || '',
      canPrevious: track?.canPrevious !== false,
      canNext: track?.canNext !== false,
      status
    }
  }
  async function publish(): Promise<void> {
    const current = session
    if (!current || disposed) return
    const next = snapshot()
    const key = JSON.stringify(next)
    if (key !== lastPublished) {
      await current.update(next)
      if (session === current) lastPublished = key
    }
    if (!enabled || !track || artworkRevision === revision) return
    const expected = revision
    const expectedGeneration = generation
    artworkRevision = expected
    const source = track.cover || options.fallbackCover
    // Decoding is deliberately outside the command queue; stale completions are discarded.
    void readArtwork(source)
      .catch((reason) => {
        if (source === options.fallbackCover) throw reason
        return readArtwork(options.fallbackCover)
      })
      .then((bytes) =>
        serialize(async () => {
          if (
            disposed ||
            !enabled ||
            session !== current ||
            generation !== expectedGeneration ||
            revision !== expected
          )
            return
          await current.artwork(bytes, expected)
        })
      )
      .catch(warn)
  }
  function schedulePublish(): void {
    void serialize(publish).catch((reason) => {
      available = false
      boundWindow = undefined
      ++generation
      void serialize(async () => {
        const failed = session
        session = undefined
        await failed?.close()
      }).catch(warn)
      warn(reason)
    })
  }
  return {
    state,
    attach(window) {
      if (options.platform !== 'win32' || disposed) return Promise.resolve()
      if (boundWindow === window) return operations.then(() => {})
      const token = ++generation
      boundWindow = window
      return serialize(async () => {
        if (disposed || generation !== token || window.isDestroyed()) return
        available = false
        const previous = session
        session = undefined
        await previous?.close()
        if (generation !== token || disposed || window.isDestroyed()) return
        try {
          enabled = options.readEnabled() !== false
          const next = create(window.getNativeWindowHandle(), (action) => {
            if (
              disposed ||
              !enabled ||
              !available ||
              token !== generation ||
              !track ||
              status === 'loading'
            )
              return
            if (!['play', 'pause', 'previous', 'next'].includes(action)) return
            if (
              (action === 'previous' && track.canPrevious === false) ||
              (action === 'next' && track.canNext === false)
            )
              return
            if (
              (action === 'play' && status === 'playing') ||
              (action === 'pause' && status !== 'playing')
            )
              return
            options.onAction(action)
          })
          session = next
          await next.ready()
          if (generation !== token || disposed || window.isDestroyed()) {
            await next.close()
            if (session === next) session = undefined
            return
          }
          available = true
          lastPublished = ''
          artworkRevision = -1
          await publish()
          window.once('closed', () => {
            if (boundWindow !== window) return
            boundWindow = undefined
            ++generation
            available = false
            void serialize(async () => {
              const old = session
              session = undefined
              await old?.close()
            }).catch(warn)
          })
        } catch (reason) {
          available = false
          if (generation === token) boundWindow = undefined
          const failed = session
          session = undefined
          await failed?.close().catch(warn)
          warn(reason)
        }
      })
    },
    updateTrack(next, playback) {
      if (JSON.stringify(track) !== JSON.stringify(next)) {
        track = next ? { ...next } : null
        ++revision
      }
      status = playback
      schedulePublish()
    },
    updatePlayback(next) {
      if (status === next) return
      status = next
      schedulePublish()
    },
    setEnabled(value) {
      return serialize(async () => {
        if (!available || !session || disposed) throw new Error('System media controls unavailable')
        const previous = enabled
        enabled = value
        artworkRevision = -1
        try {
          await publish()
          options.writeEnabled(value)
          return state()
        } catch (reason) {
          enabled = previous
          lastPublished = ''
          artworkRevision = -1
          await publish().catch(warn)
          throw reason
        }
      })
    },
    dispose() {
      disposed = true
      available = false
      ++generation
      return serialize(async () => {
        const old = session
        session = undefined
        await old?.close()
      })
    }
  }
}
