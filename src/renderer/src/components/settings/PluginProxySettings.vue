<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'
import { normalizePluginProxy } from '../../../../shared/pluginProxy'

const { t } = useI18n()
const { success, error } = useMessage()
const enabled = ref(false)
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
    enabled.value = result.data.enabled
    url.value = result.data.url
  } catch {
    loadFailed.value = true
    failure.value = t('pluginProxy.loadFailed')
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  saving.value = true
  failure.value = ''
  try {
    let settings
    try {
      settings = normalizePluginProxy({ enabled: enabled.value, url: url.value })
    } catch {
      throw new Error(t('pluginProxy.invalid'))
    }
    const result = await window.api.plugins.setProxy(settings)
    if (!result.success) throw new Error(result.error || t('pluginProxy.saveFailed'))
    url.value = settings.url
    success(t('pluginProxy.saved'))
  } catch (reason) {
    failure.value = reason instanceof Error ? reason.message : t('pluginProxy.saveFailed')
    error(failure.value)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <form @submit.prevent="save">
    <SettingRow :label="t('pluginProxy.enabled')" :description="t('pluginProxy.description')">
      <template #default="{ labelId, descriptionId }">
        <BaseSwitch
          :model-value="enabled"
          :disabled="loading || saving || loadFailed"
          :aria-labelledby="labelId"
          :aria-describedby="descriptionId"
          @update:model-value="enabled = $event === true"
        />
      </template>
    </SettingRow>
    <SettingRow :label="t('pluginProxy.address')" :description="t('pluginProxy.addressHint')">
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
      <BaseButton v-else type="submit" :loading="saving" :disabled="loading || saving">
        {{ t('pluginProxy.save') }}
      </BaseButton>
    </div>
  </form>
</template>
