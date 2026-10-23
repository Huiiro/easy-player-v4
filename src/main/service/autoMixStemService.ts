import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { createInterface } from 'node:readline'

export interface AutoMixStemRequest {
  sourcePath: string
  nextPath: string
  revision: number
  sampleRate: number
  channels: number
  outStartFrame: number
  inStartFrame: number
  fadeFrames: number
  vocalCue?: boolean
}
interface Job {
  id: number
  request: AutoMixStemRequest
}
interface Options {
  python: string
  worker: string
  cache: string
  ffmpeg?: string
  timeoutMs?: number
  onReady: (
    request: AutoMixStemRequest,
    outVocals: string,
    inVocals: string,
    cueStartFrame: number,
    outStartFrame: number
  ) => void
  onStatus: (message: string) => void
}

/** One local worker, one active job, and only the newest pending queue item. */
export class AutoMixStemService {
  private child?: ChildProcessWithoutNullStreams
  private active?: Job
  private pending?: Job
  private latest = 0
  private timer?: ReturnType<typeof setTimeout>
  private debounce?: ReturnType<typeof setTimeout>
  private idle?: ReturnType<typeof setTimeout>
  private closed = false
  private diagnostic = ''

  constructor(private readonly options: Options) {}

  request(request: AutoMixStemRequest | null): void {
    const id = ++this.latest
    clearTimeout(this.debounce)
    this.pending = undefined
    if (!request || this.closed || request.fadeFrames <= 0 || request.sampleRate <= 0) {
      this.shutdown()
      return
    }
    if (!existsSync(this.options.python) || !existsSync(this.options.worker)) return
    this.debounce = setTimeout(() => {
      this.pending = { id, request }
      this.pump()
    }, 800)
    this.debounce.unref()
  }

  close(): void {
    this.closed = true
    this.cancel()
    this.shutdown()
  }

  cancel(): void {
    ++this.latest
    this.pending = undefined
    clearTimeout(this.debounce)
    this.shutdown()
  }

  private pump(): void {
    if (this.closed || this.active || !this.pending) return
    clearTimeout(this.idle)
    mkdirSync(this.options.cache, { recursive: true })
    if (!this.child) this.start()
    this.active = this.pending
    this.pending = undefined
    const job = this.active
    this.options.onStatus('Preparing local vocal stems in background')
    this.child!.stdin.write(JSON.stringify({ id: job.id, ...job.request }) + '\n', (error) => {
      if (error && this.active?.id === job.id) this.fail(error.message)
    })
    this.timer = setTimeout(
      () => this.fail('Stem preparation timed out; keep ordinary overlap'),
      this.options.timeoutMs ?? 180_000
    )
    this.timer.unref()
  }

  private start(): void {
    const child = spawn(
      this.options.python,
      [
        '-u',
        this.options.worker,
        '--cache',
        this.options.cache,
        '--ffmpeg',
        this.options.ffmpeg ?? 'ffmpeg'
      ],
      {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1' }
      }
    )
    this.child = child
    this.diagnostic = ''
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (this.child !== child || !this.active || line.length > 16_384) return
      try {
        const response = JSON.parse(line) as Record<string, unknown>
        if (response.id !== this.active.id) return
        const job = this.active
        clearTimeout(this.timer)
        this.active = undefined
        if (
          job.id === this.latest &&
          response.ok === true &&
          typeof response.outVocals === 'string' &&
          typeof response.inVocals === 'string' &&
          this.cachedFile(response.outVocals) &&
          this.cachedFile(response.inVocals)
        ) {
          this.options.onReady(
            job.request,
            response.outVocals,
            response.inVocals,
            typeof response.cueStartFrame === 'number' &&
              Number.isSafeInteger(response.cueStartFrame) &&
              response.cueStartFrame >= 0
              ? response.cueStartFrame
              : job.request.inStartFrame,
            typeof response.outStartFrame === 'number' &&
              Number.isSafeInteger(response.outStartFrame) &&
              response.outStartFrame >= 0
              ? response.outStartFrame
              : job.request.outStartFrame
          )
          this.options.onStatus(
            `Vocal stems ready (${String(response.seconds)}s${response.cached ? ', cached' : ''})`
          )
        } else if (job.id === this.latest && response.ok !== true) {
          this.options.onStatus(
            `Vocal stems unavailable: ${String(response.error ?? 'invalid response')}`
          )
        }
        if (this.pending) this.pump()
        else {
          this.idle = setTimeout(() => this.shutdown(), 60_000)
          this.idle.unref()
        }
      } catch (error) {
        this.fail(`Stem worker response failed: ${String(error)}`)
      }
    })
    child.stderr.on('data', (data: Buffer) => {
      this.diagnostic = (this.diagnostic + data.toString()).slice(-2000)
    })
    child.on('error', (error) => {
      if (this.child === child) this.fail(error.message)
    })
    child.on('exit', () => {
      lines.close()
      if (this.child === child) this.fail(this.diagnostic || 'Stem worker exited')
    })
  }

  private cachedFile(path: string): boolean {
    const childPath = relative(this.options.cache, path)
    return (
      !childPath.startsWith('..') &&
      !isAbsolute(childPath) &&
      path.endsWith('.wav') &&
      existsSync(path)
    )
  }

  private fail(message: string): void {
    this.options.onStatus(message)
    this.shutdown()
    if (this.pending) this.pump()
  }

  private shutdown(): void {
    clearTimeout(this.timer)
    clearTimeout(this.idle)
    this.active = undefined
    const child = this.child
    this.child = undefined
    child?.kill()
  }
}
