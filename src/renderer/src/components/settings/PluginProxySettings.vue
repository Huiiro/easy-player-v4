<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'
import { normalizePluginProxy, type PluginProxyMode } from '../../../../shared/pluginProxy'

const { t } = useI18n()
const { success, error } = useMessage()
const mode = ref<PluginProxyMode>('direct')
const savedMode = ref<PluginProxyMode>('direct')
const modes = computed(() =>
  ['direct', 'system', 'custom'].map((value) => ({
    value,
    label: t(`pluginProxy.${value}`)
  }))
)
const url = ref('')
const loading = ref(true)
const saving = ref(false)
const loadFailed = ref(false)
const failure = ref('')

async function load(): Promise<void> {
  loading.value = true
  loadFailed.value = false
  failure.value = ''
  try {
    const result = await window.api.plugins.getProxy()
    if (!result.success || !result.data)
      throw new Error(result.error || t('pluginProxy.loadFailed'))
    mode.value = result.data.mode
    savedMode.value = result.data.mode
    url.value = result.data.url
  } catch {
    loadFailed.value = true
    failure.value = t('pluginProxy.loadFailed')
  } finally {
    loading.value = false
  }
}

async function save(): Promise<boolean> {
  if (loading.value || saving.value || loadFailed.value) return false
  saving.value = true
  failure.value = ''
  try {
    let settings
    try {
      settings = normalizePluginProxy({ mode: mode.value, url: url.value })
    } catch {
      throw new Error(t('pluginProxy.invalid'))
    }
    const result = await window.api.plugins.setProxy(settings)
    if (!result.success) throw new Error(result.error || t('pluginProxy.saveFailed'))
    savedMode.value = settings.mode
    url.value = settings.url
    success(t('pluginProxy.saved'))
    return true
  } catch (reason) {
    failure.value = reason instanceof Error ? reason.message : t('pluginProxy.saveFailed')
    error(failure.value)
    return false
  } finally {
    saving.value = false
  }
}

async function changeMode(value: string | number | (string | number)[]): Promise<void> {
  if (loading.value || saving.value || loadFailed.value || value === mode.value) return
  if (value !== 'direct' && value !== 'system' && value !== 'custom') return
  mode.value = value
  failure.value = ''
  if (value === 'custom') {
    try {
      normalizePluginProxy({ mode: value, url: url.value })
    } catch {
      // A new custom proxy needs an address before it can be activated and saved.
      return
    }
  }
  if (!(await save())) mode.value = savedMode.value
}

onMounted(load)
</script>

<template>
  <form @submit.prevent="save">
    <SettingRow :label="t('pluginProxy.mode')" :description="t('pluginProxy.description')">
      <template #default="{ labelId, descriptionId }">
        <BaseSelect
          class="w-48"
          :model-value="mode"
          :options="modes"
          :aria-label="t('pluginProxy.mode')"
          :disabled="loading || saving || loadFailed"
          :aria-labelledby="labelId"
          :aria-describedby="descriptionId"
          @update:model-value="changeMode"
        />
      </template>
    </SettingRow>
    <SettingRow
      v-if="mode === 'custom'"
      :label="t('pluginProxy.address')"
      :description="t('pluginProxy.addressHint')"
    >
      <template #default="{ labelId, descriptionId }">
        <BaseInput
          v-model="url"
          class="w-full max-w-sm"
          placeholder="http://127.0.0.1:7890"
          :disabled="loading || saving || loadFailed"
          :aria-labelledby="labelId"
          :aria-describedby="descriptionId"
          spellcheck="false"
          autocomplete="off"
        />
      </template>
    </SettingRow>
    <div class="flex items-center justify-end gap-3 px-5 py-3">
      <p v-if="failure" role="alert" class="text-xs text-danger">{{ failure }}</p>
      <BaseButton v-if="loadFailed" :loading="loading" @click="load">
        {{ t('pluginProxy.retry') }}
      </BaseButton>
      <BaseButton
        v-else-if="mode === 'custom'"
        type="submit"
        :loading="saving"
        :disabled="loading || saving"
      >
        {{ t('pluginProxy.save') }}
      </BaseButton>
    </div>
  </form>
</template>
