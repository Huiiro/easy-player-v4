import { spawn } from 'node:child_process'
import { compatibleFingerprint } from './fingerprintCompatibilityDecoder'
import { fingerprintDiagnostic, FingerprintExtractionError } from './fingerprintExtractionError'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { onPlaybackModeChanged, waitForBackgroundWork } from './playbackMode'
import {
  FINGERPRINT_SAMPLE_SECONDS,
  validFingerprint,
  type AudioFingerprint
} from './audioFingerprintMatching'

export async function requireFingerprintTool(executable: string): Promise<void> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(path.dirname(executable), 'manifest.json'), 'utf8')
    )
    const hash = createHash('sha256')
      .update(await readFile(executable))
      .digest('hex')
    if (manifest.version !== '1.6.2' || hash !== manifest.executableSha256)
      throw new Error('invalidFingerprintTool')
  } catch {
    throw new Error('fingerprintMissing')
  }
}

/** Decode locally in an isolated, cancellable process. Never write to the audio file. */
async function extractFingerprint(
  executable: string,
  file: string,
  signal?: AbortSignal,
  sampleSeconds: 60 | 120 = FINGERPRINT_SAMPLE_SECONDS
): Promise<AudioFingerprint> {
  for (;;) {
    await waitForBackgroundWork(signal)
    signal?.throwIfAborted()
    try {
      return await new Promise<AudioFingerprint>((resolve, reject) => {
        const child = spawn(
          executable,
          ['-json', '-raw', '-algorithm', '2', '-length', String(sampleSeconds), '--', file],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        )
        let output = ''
        let stderr = ''
        let paused = false
        let failure: 'timeout' | 'outputLimit' | undefined
        const timer = setTimeout(() => {
          failure = 'timeout'
          child.kill()
        }, 120_000)
        const offPlayback = onPlaybackModeChanged((enabled) => {
          if (enabled) {
            paused = true
            child.kill()
          }
        })
        const abort = (): void => {
          child.kill()
        }
        signal?.addEventListener('abort', abort, { once: true })
        child.stdout.on('data', (chunk: Buffer) => {
          output = (output + chunk.toString('utf8')).slice(0, 100001)
          if (output.length > 100_000) {
            failure ??= 'outputLimit'
            child.kill()
          }
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString('utf8')).slice(-4096)
        })
        const clean = (): void => {
          clearTimeout(timer)
          offPlayback()
          signal?.removeEventListener('abort', abort)
        }
        child.once('error', (error) => {
          clean()
          reject(new FingerprintExtractionError('spawn', stderr, undefined, error.message))
        })
        child.once('close', (code) => {
          clean()
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          if (paused) {
            reject(new Error('playbackPaused'))
            return
          }
          if (failure || (code !== 0 && code !== 3)) {
            reject(new FingerprintExtractionError(failure ?? 'decodeFailed', stderr, code))
            return
          }
          try {
            const result = JSON.parse(output)
            const fingerprint = { data: result.fingerprint, duration: result.duration }
            if (!validFingerprint(fingerprint))
              throw new FingerprintExtractionError(
                Array.isArray(fingerprint.data) && fingerprint.data.length < 100
                  ? 'insufficientAudio'
                  : 'invalidOutput',
                stderr,
                code
              )
            resolve(
              code === 3
                ? {
                    ...fingerprint,
                    notices: [
                      {
                        reason: 'decodeWarning',
                        exitCode: code,
                        stderr: fingerprintDiagnostic(stderr)
                      }
                    ]
                  }
                : fingerprint
            )
          } catch (error) {
            reject(
              error instanceof FingerprintExtractionError
                ? error
                : new FingerprintExtractionError('invalidOutput', stderr, code)
            )
          }
        })
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'playbackPaused') continue
      throw error
    }
  }
}

export async function calculateAudioFingerprint(
  executable: string,
  file: string,
  signal?: AbortSignal,
  sampleSeconds: 60 | 120 = FINGERPRINT_SAMPLE_SECONDS,
  compatibility?: { ffmpeg: string; sourceDuration?: number }
): Promise<AudioFingerprint> {
  for (;;) {
    signal?.throwIfAborted()
    try {
      return await extractFingerprint(executable, file, signal, sampleSeconds)
    } catch (error) {
      signal?.throwIfAborted()
      if (
        !(error instanceof FingerprintExtractionError) ||
        error.reason !== 'decodeFailed' ||
        error.exitCode !== 2 ||
        !compatibility ||
        !/\.(dff|dsf)$/i.test(file)
      )
        throw error
      try {
        return await compatibleFingerprint(
          compatibility.ffmpeg,
          file,
          sampleSeconds,
          compatibility.sourceDuration,
          (wav) => extractFingerprint(executable, wav, signal, sampleSeconds),
          error,
          signal
        )
      } catch (fallbackError) {
        signal?.throwIfAborted()
        if (fallbackError instanceof Error && fallbackError.message === 'playbackPaused') continue
        throw fallbackError
      }
    }
  }
}
