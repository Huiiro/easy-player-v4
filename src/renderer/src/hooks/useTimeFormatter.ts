import { useI18n } from 'vue-i18n'

export function useFriendlyTime(): {
  format: (value: string | number | Date | null | undefined) => string
} {
  const { t } = useI18n()
  const pad = (value: number): string => String(value).padStart(2, '0')

  function format(value: string | number | Date | null | undefined): string {
    if (!value) return '—'
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    const now = new Date()
    const diff = Math.max(0, now.getTime() - date.getTime())
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour
    const week = 7 * day
    const month = 30 * day
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
    if (diff < 5 * minute) return t('time.justNow')
    if (diff < hour) return t('time.minutesAgo', { n: Math.floor(diff / minute) })
    if (diff < day) return t('time.hoursAgo', { n: Math.floor(diff / hour) })
    const dayDiff = Math.floor(diff / day)
    if (dayDiff === 1) return t('time.yesterday', { time })
    if (dayDiff < 7) return `${t(`time.weekday.${date.getDay()}`)} ${time}`
    if (diff < month) return t('time.weeksAgo', { n: Math.floor(diff / week) })
    const monthDiff =
      now.getFullYear() * 12 + now.getMonth() - (date.getFullYear() * 12 + date.getMonth())
    if (monthDiff === 1) return t('time.lastMonth')
    if (monthDiff < 12) return t('time.monthsAgo', { n: monthDiff })
    const yearDiff = now.getFullYear() - date.getFullYear()
    if (yearDiff === 1) return t('time.lastYear')
    return t('time.yearsAgo', { n: yearDiff })
  }

  return { format }
}
