<script setup lang="ts">
import SettingRow from './SettingRow.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { normalizeFooterLayout, type FooterLayout } from '@/utils/footerLayout'

const ui = useUIStore()
const { t } = useI18n()
const layout = computed(() => normalizeFooterLayout(ui.footerLayout))
const modes = computed(() => [
  { value: 'centered', label: t('footerLayout.centered') },
  { value: 'stacked', label: t('footerLayout.stacked') }
])
function update(key: keyof FooterLayout, value: unknown): void {
  ui.footerLayout = normalizeFooterLayout({ ...layout.value, [key]: value })
}
</script>

<template>
  <section :aria-label="t('footerLayout.title')">
    <SettingRow :label="t('footerLayout.title')" :description="t('footerLayout.description')">
      <BaseSwitch :model-value="layout.enabled" @update:model-value="update('enabled', $event)" />
    </SettingRow>
    <template v-if="layout.enabled">
      <div class="setting-row">
        <label class="text-sm">{{ t('footerLayout.mode') }}</label>
        <div class="flex items-center gap-3">
          <BaseSelect
            :model-value="layout.mode"
            :options="modes"
            class="w-48"
            teleport
            @update:model-value="update('mode', $event)"
          />
          <BaseButton size="sm" variant="secondary" @click="ui.resetFooterLayout()">
            {{ t('footerLayout.reset') }}
          </BaseButton>
        </div>
      </div>
      <div class="setting-row">
        <label class="text-sm">{{ t('footerLayout.width') }}</label>
        <div class="flex w-64 items-center gap-4">
          <BaseSlider
            :model-value="layout.maxWidth"
            :min="900"
            :max="1800"
            :step="20"
            size="sm"
            class="min-w-0 flex-1"
            @update:model-value="update('maxWidth', $event)"
          />
          <output class="w-16 shrink-0 text-right text-sm tabular-nums">
            {{ layout.maxWidth }}px
          </output>
        </div>
      </div>
      <div v-if="layout.mode === 'centered'" class="setting-row">
        <label class="text-sm">{{ t('footerLayout.progress') }}</label>
        <div class="flex w-64 items-center gap-4">
          <BaseSlider
            :model-value="layout.progressWeight"
            :min="1"
            :max="4"
            :step="0.1"
            size="sm"
            class="min-w-0 flex-1"
            @update:model-value="update('progressWeight', $event)"
          />
          <output class="w-16 shrink-0 text-right text-sm tabular-nums">
            {{ layout.progressWeight.toFixed(1) }}×
          </output>
        </div>
      </div>
    </template>
  </section>
</template>
