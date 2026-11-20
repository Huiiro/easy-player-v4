import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'

export function useAppearanceFontOptions(): ComputedRef<{ label: string; value: string }[]> {
  const ui = useUIStore()
  const { t } = useI18n()
  return computed(() => [
    { label: t('settings.fontSystemDefault'), value: '' },
    { label: t('settings.fontSystemUi'), value: 'system-ui' },
    { label: t('settings.fontAppleMusic'), value: 'SF Pro Display' },
    { label: t('settings.fontAppleMusicRounded'), value: 'SF Pro Rounded' },
    { label: t('settings.fontPingfang'), value: 'PingFang SC' },
    { label: t('settings.fontSegoeUiVariable'), value: 'Segoe UI Variable' },
    { label: t('settings.fontMicrosoftYahei'), value: 'Microsoft YaHei' },
    { label: t('settings.fontMiSans'), value: 'MiSans' },
    { label: t('settings.fontHarmonyOsSans'), value: 'HarmonyOS Sans SC' },
    { label: t('settings.fontSourceHanSans'), value: 'Source Han Sans SC' },
    { label: t('settings.fontNotoSans'), value: 'Noto Sans SC' },
    ...ui.customFonts.map((font) => ({ label: font.file, value: font.family }))
  ])
}
