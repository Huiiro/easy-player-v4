import { createI18n } from 'vue-i18n'
import en from './locales/en.ts'
import zh from './locales/zh.ts'

const i18n = createI18n({
  locale: 'zh',
  fallbackLocale: 'en',
  messages: {
    en,
    zh
  }
})

/**
 * 暴露方法
 * @param key
 */
export const t = (key: string): string => {
  return i18n.global.t(key)
}

/**
 * 注册插件 I18n
 * @param i18nOptions
 *   "i18nOptions": {
 *     "zh": {
 *       "plugin_custom_alt": "自定义"
 *     },
 *     "en": {
 *       "plugin_custom_alt": "custom"
 *     }
 *   }
 */
export function registerPluginI18n(i18nOptions: Record<string, string>): void {
  const global = i18n.global

  Object.entries(i18nOptions).forEach(([lang, messages]) => {
    const current = global.getLocaleMessage(lang) || {}

    global.setLocaleMessage(lang, {
      ...current,
      ...messages
    })
  })
}

export default i18n
