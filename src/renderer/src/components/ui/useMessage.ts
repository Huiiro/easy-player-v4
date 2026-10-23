import { readonly, ref, type DeepReadonly, type Ref } from 'vue'

export interface MessageOptions {
  message: string
  type?: 'success' | 'warning' | 'info' | 'error'
  duration?: number
  showClose?: boolean
  onClose?: () => void
  dedupeKey?: string
}

export interface MessageInstance {
  id: number
  createdAt: number
  message: string
  type: 'success' | 'warning' | 'info' | 'error'
  duration: number
  showClose: boolean
  onClose?: () => void
  dedupeKey?: string
}

/** 全局共享的消息列表 */
const messages = ref<MessageInstance[]>([])
let idCounter = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const config = { max: 5 }

function add(options: MessageOptions): number {
  const existing =
    options.dedupeKey && messages.value.find((message) => message.dedupeKey === options.dedupeKey)
  if (existing) return existing.id
  while (messages.value.length >= config.max) remove(messages.value[0].id)
  const id = ++idCounter
  const msg: MessageInstance = {
    id,
    message: options.message,
    type: options.type ?? 'info',
    duration: options.duration ?? 3000,
    showClose: options.showClose ?? false,
    onClose: options.onClose,
    dedupeKey: options.dedupeKey,
    createdAt: Date.now()
  }
  messages.value.push(msg)

  if (msg.duration > 0) {
    timers.set(
      id,
      setTimeout(() => remove(id), msg.duration)
    )
  }
  return id
}

function remove(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  const idx = messages.value.findIndex((m) => m.id === id)
  if (idx !== -1) {
    const msg = messages.value[idx]
    messages.value.splice(idx, 1)
    msg.onClose?.()
  }
}

function clear(): void {
  const ids = messages.value.map((message) => message.id)
  ids.forEach(remove)
}

function configure(options: { max?: number }): void {
  if (options.max !== undefined && Number.isFinite(options.max))
    config.max = Math.max(1, Math.floor(options.max))
  while (messages.value.length > config.max) remove(messages.value[0].id)
}

export function useMessage(): {
  messages: DeepReadonly<Ref<MessageInstance[]>>
  success: (message: string, duration?: number) => number
  warning: (message: string, duration?: number) => number
  info: (message: string, duration?: number) => number
  error: (message: string, duration?: number) => number
  remove: typeof remove
  clear: typeof clear
  configure: typeof configure
  add: typeof add
} {
  const success = (msg: string, duration?: number): number =>
    add({ message: msg, type: 'success', duration })

  const warning = (msg: string, duration?: number): number =>
    add({ message: msg, type: 'warning', duration })

  const info = (msg: string, duration?: number): number =>
    add({ message: msg, type: 'info', duration })

  const error = (msg: string, duration?: number): number =>
    add({ message: msg, type: 'error', duration, showClose: true })

  return {
    /** 全局消息列表（MessageContainer 使用） */
    messages: readonly(messages),
    success,
    warning,
    info,
    error,
    remove,
    clear,
    configure,
    add
  }
}
