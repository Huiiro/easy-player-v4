import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { AudioFingerprint } from './audioFingerprintMatching'
import { FingerprintExtractionError, fingerprintDiagnostic } from './fingerprintExtractionError'
import { onPlaybackModeChanged, waitForBackgroundWork } from './playbackMode'

async function decode(
  ffmpeg: string,
  file: string,
  wav: string,
  seconds: number,
  signal?: AbortSignal
): Promise<string> {
  await waitForBackgroundWork(signal)
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-t',
        String(seconds),
        '-ar',
        '11025',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        '-y',
        wav
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    let stderr = ''
    let paused = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 120000)
    const off = onPlaybackModeChanged((enabled) => {
      if (enabled) {
        paused = true
        child.kill()
      }
    })
    const abort = (): void => {
      child.kill()
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4096)
    })
    const clean = (): void => {
      clearTimeout(timer)
      off()
      signal?.removeEventListener('abort', abort)
    }
    child.once('error', (error) => {
      clean()
      reject(new FingerprintExtractionError('spawn', stderr, undefined, error.message))
    })
    child.once('close', (code) => {
      clean()
      if (signal?.aborted) reject(signal.reason)
      else if (paused) reject(new Error('playbackPaused'))
      else if (timedOut || code !== 0)
        reject(new FingerprintExtractionError(timedOut ? 'timeout' : 'decodeFailed', stderr, code))
      else resolve(fingerprintDiagnostic(stderr))
    })
  })
}

/** Decode only the configured segment to an owned temporary WAV, never touch source files. */
export async function compatibleFingerprint(
  ffmpeg: string,
  file: string,
  seconds: number,
  sourceDuration: number | undefined,
  extract: (wav: string) => Promise<AudioFingerprint>,
  initialError: FingerprintExtractionError,
  signal?: AbortSignal
): Promise<AudioFingerprint> {
  const root = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(root, 'easy-player-fingerprint-'))
  if (
    path.dirname(path.resolve(directory)) !== root ||
    !path.basename(directory).startsWith('easy-player-fingerprint-')
  )
    throw new Error('Invalid fingerprint temp directory')
  try {
    const stderr = await decode(ffmpeg, file, path.join(directory, 'audio.wav'), seconds, signal)
    signal?.throwIfAborted()
    const fingerprint = await extract(path.join(directory, 'audio.wav'))
    signal?.throwIfAborted()
    return {
      ...fingerprint,
      duration:
        sourceDuration && Number.isFinite(sourceDuration) && sourceDuration > 0
          ? sourceDuration
          : fingerprint.duration,
      notices: [
        ...(fingerprint.notices ?? []),
        {
          reason: 'compatibilityDecode',
          exitCode: initialError.exitCode,
          stderr: fingerprintDiagnostic([initialError.stderr, stderr].filter(Boolean).join('\n'))
        }
      ]
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
