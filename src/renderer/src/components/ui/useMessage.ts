import { ref } from 'vue'

export interface MessageOptions {
  message: string
  type?: 'success' | 'warning' | 'info' | 'error'
  duration?: number
  showClose?: boolean
  onClose?: () => void
}

export interface MessageInstance {
  id: number
  createdAt: number
  message: string
  type: 'success' | 'warning' | 'info' | 'error'
  duration: number
  showClose: boolean
  onClose?: () => void
}

/** 全局共享的消息列表 */
const messages = ref<MessageInstance[]>([])
let idCounter = 0

function add(options: MessageOptions): number {
  const id = ++idCounter
  const msg: MessageInstance = {
    id,
    message: options.message,
    type: options.type ?? 'info',
    duration: options.duration ?? 3000,
    showClose: options.showClose ?? false,
    onClose: options.onClose,
    createdAt: Date.now()
  }
  messages.value.push(msg)

  if (msg.duration > 0) {
    setTimeout(() => remove(id), msg.duration)
  }
  return id
}

function remove(id: number): void {
  const idx = messages.value.findIndex((m) => m.id === id)
  if (idx !== -1) {
    const msg = messages.value[idx]
    messages.value.splice(idx, 1)
    msg.onClose?.()
  }
}

export function useMessage() {
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
    messages,
    success,
    warning,
    info,
    error,
    remove,
    add
  }
}
