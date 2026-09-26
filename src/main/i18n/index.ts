import en from './locales/en'
import zh from './locales/zh'

export type MainLocale = 'zh' | 'en'
export type MessageKey = keyof typeof en
let locale: MainLocale = 'zh'

export function setMainLocale(value: unknown): void {
  if (value === 'zh' || value === 'en') locale = value
}

export function t(
  key: MessageKey,
  params: Record<string, string | number> = {},
  language: MainLocale = locale
): string {
  const message = (language === 'zh' ? zh : en)[key] ?? en[key]
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  )
}
