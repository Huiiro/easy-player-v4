import { useI18n } from 'vue-i18n'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useFriendlyTime() {
  const { t } = useI18n()

  const pad = (n: number): string => n.toString().padStart(2, '0')

  function format(date: Date): string {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const week = 7 * day
    const month = 30 * day
    // const year = 365 * day

    const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`

    if (diffMs < 5 * minute) return t('time.justNow')

    if (diffMs < hour) return t('time.minutesAgo', { n: Math.floor(diffMs / minute) })

    if (diffMs < day) return t('time.hoursAgo', { n: Math.floor(diffMs / hour) })

    const dayDiff = Math.floor(diffMs / day)

    if (dayDiff === 1) return t('time.yesterday', { time: timePart })

    if (dayDiff < 7) return t('time.weekday.' + date.getDay()) + ' ' + timePart

    if (diffMs < month) return t('time.weeksAgo', { n: Math.floor(diffMs / week) })

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
