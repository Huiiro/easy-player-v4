<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseDisclosure from '@/components/ui/BaseDisclosure.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import LiquidGlassSlider from './LiquidGlassSlider.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { mountLiquidGlassStudio } from '@/services/liquidGlassStudio'
import {
  LIQUID_GLASS_ADVANCED_SLIDERS,
  LIQUID_GLASS_BASIC_SLIDERS,
  LIQUID_GLASS_SETTING_KEYS,
  resolveLiquidGlassSettings,
  type LiquidGlassSetting,
  type LiquidGlassSliderKey
} from '@/services/liquidGlassProfile'

const ui = useUIStore()
const { t, locale } = useI18n()
const draft = ref({ ...ui.liquidGlassSettings })
const preview = ref<HTMLElement>()
const units: Partial<Record<LiquidGlassSliderKey, string>> = {
  refThickness: ' px',
  blurRadius: ' px',
  refFresnelFactor: '%',
  glareFactor: '%',
  glareAngle: '°',
  refFresnelHardness: '%',
  glareHardness: '%',
  glareConvergence: '%',
  glareOppositeFactor: '%',
  shadowExpand: ' px',
  shadowFactor: '%',
  shadowOffsetX: ' px',
  shadowOffsetY: ' px'
}
const formatter = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }))
const defaults = resolveLiquidGlassSettings()
const atDefaults = computed(() =>
  LIQUID_GLASS_SETTING_KEYS.every((key) => draft.value[key] === defaults[key])
)
const valueText = (key: LiquidGlassSliderKey): string =>
  formatter.value.format(draft.value[key]) + (units[key] ?? '')

let controller: ReturnType<typeof mountLiquidGlassStudio> | undefined
onMounted(() => {
  controller = mountLiquidGlassStudio({
    id: 'ep-glass-settings-preview',
    selector: '.liquid-glass-preview-surface',
    background: preview.value,
    settings: draft.value
  })
})
onUnmounted(() => controller?.dispose())
watch(draft, (settings) => controller?.setSettings(settings), { deep: true, flush: 'post' })
watch(
  () => ui.liquidGlassSettings,
  (settings) => (draft.value = { ...settings })
)

function save(key: LiquidGlassSetting, value = draft.value[key]): void {
  ui.liquidGlassSettings = resolveLiquidGlassSettings({
    ...ui.liquidGlassSettings,
    [key]: value
  })
}

function reset(): void {
  draft.value = resolveLiquidGlassSettings()
  ui.liquidGlassSettings = { ...draft.value }
}
</script>

<template>
  <section
    class="glass-settings mx-5 my-3 rounded-xl border border-border p-4"
    :aria-label="t('settings.liquidGlass.customize')"
  >
    <div class="glass-settings-header mb-3 flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium">{{ t('settings.liquidGlass.preview') }}</h3>
      <BaseButton size="sm" variant="secondary" :disabled="atDefaults" @click="reset">
        {{ t('settings.restoreDefault') }}
      </BaseButton>
    </div>
    <div class="glass-settings-grid grid items-start gap-4">
      <div
        ref="preview"
        class="glass-settings-preview grid place-items-center overflow-hidden rounded-lg"
        aria-hidden="true"
      >
        <div
          class="liquid-glass-preview-surface relative grid place-items-center rounded-[1.75rem] border text-base font-semibold text-white"
          :style="{ '--ep-studio-blur-radius': draft.blurRadius }"
        >
          Liquid Glass
        </div>
      </div>
      <div class="min-w-0">
        <div class="glass-settings-controls grid gap-y-2.5">
          <LiquidGlassSlider
            v-for="key in LIQUID_GLASS_BASIC_SLIDERS"
            :key="key"
            v-model="draft[key]"
            :field="key"
            :label="t(`settings.liquidGlass.${key}`)"
            :value-text="valueText(key)"
            @change="save(key)"
          />
        </div>
        <BaseDisclosure
          class="glass-settings-advanced mt-3 border-t border-border"
          :label="t('settings.liquidGlass.advanced')"
        >
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>{{ t('settings.liquidGlass.blurEdge') }}</span>
            <BaseSwitch
              size="sm"
              :model-value="draft.blurEdge"
              :aria-label="t('settings.liquidGlass.blurEdge')"
              @update:model-value="save('blurEdge', $event === true)"
            />
          </div>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>{{ t('settings.liquidGlass.tintColor') }}</span>
            <BaseColorPicker
              show-alpha
              teleport
              :model-value="draft.tintColor"
              :aria-label="t('settings.liquidGlass.tintColor')"
              @update:model-value="save('tintColor', $event)"
            />
          </div>
          <div class="glass-settings-controls grid gap-y-2.5">
            <LiquidGlassSlider
              v-for="key in LIQUID_GLASS_ADVANCED_SLIDERS"
              :key="key"
              v-model="draft[key]"
              :field="key"
              :label="t(`settings.liquidGlass.${key}`)"
              :value-text="valueText(key)"
              @change="save(key)"
            />
          </div>
        </BaseDisclosure>
      </div>
    </div>
  </section>
</template>

<style scoped>
.glass-settings {
  container-type: inline-size;
}
.glass-settings-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}
.glass-settings-preview {
  min-height: 12rem;
  background-color: #191c3a;
  background-image:
    linear-gradient(
      118deg,
      transparent 29%,
      rgb(226 248 255 / 55%) 29%,
      rgb(226 248 255 / 55%) 30%,
      transparent 30%,
      transparent 57%,
      rgb(250 215 255 / 55%) 57%,
      rgb(250 215 255 / 55%) 59%,
      transparent 59%
    ),
    radial-gradient(circle at 27% 26%, #508ecd 0%, transparent 53%),
    radial-gradient(circle at 78% 75%, #a05292 0%, transparent 54%);
}
.liquid-glass-preview-surface {
  --ep-studio-surface-tint: 12%;
  width: min(76%, 13rem);
  min-height: 6.75rem;
  background-color: rgb(25 28 58 / 12%);
  backdrop-filter: blur(calc(var(--ep-studio-blur-radius) * 0.333px));
  border-color: rgb(255 255 255 / 25%);
}
.glass-settings-controls {
  grid-template-columns: fit-content(45%) minmax(0, 1fr) 3.25rem;
}
@container (min-width: 33rem) {
  .glass-settings-preview {
    position: sticky;
    top: 1rem;
  }
}
</style>
