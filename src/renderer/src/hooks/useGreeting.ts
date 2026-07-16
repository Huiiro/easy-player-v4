import { useI18n } from 'vue-i18n'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useGreeting() {
  const { t, locale } = useI18n()

  function getGreeting(name?: string): string {
    const hour = new Date().getHours()

    let key: string
    let emoji: string

    if (hour >= 5 && hour < 12) {
      key = 'morning'
      emoji = '🌅'
    } else if (hour >= 12 && hour < 14) {
      key = 'noon'
      emoji = '☀️'
    } else if (hour >= 14 && hour < 18) {
      key = 'afternoon'
      emoji = '🌤'
    } else if (hour >= 18 && hour < 24) {
      key = 'evening'
      emoji = '🌙'
    } else {
      key = 'lateNight'
      emoji = '🌌'
    }

    const comma = locale.value.startsWith('zh') ? '，' : ', '
    const welcome = t('greeting.welcome', { name: name ?? '', comma })
    const timeGreeting = t(`greeting.${key}`)

    return `${emoji} ${welcome}！${timeGreeting}`
  }

  return { getGreeting }
}
