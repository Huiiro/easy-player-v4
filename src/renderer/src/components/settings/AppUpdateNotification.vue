<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { createAutomaticUpdateChecker } from '@/services/automaticUpdates'

const ui = useUIStore()
const { t } = useI18n()
const updates = useAppUpdateStore()
const version = ref('')
const ignoreVersion = ref(false)
const open = computed({
  get: () => Boolean(version.value),
  set: (visible: boolean) => {
    if (visible) return
    if (ignoreVersion.value && !ui.ignoredUpdateVersions.includes(version.value))
      ui.ignoredUpdateVersions.push(version.value)
    version.value = ''
    ignoreVersion.value = false
  }
})
const checker = createAutomaticUpdateChecker({
  async check() {
    const current = await window.api.appUpdate.status()
    // Leave an explicit check or download already in progress alone.
    const state = (current.data as { state?: string } | undefined)?.state
    if (state && ['checking', 'downloading', 'downloaded'].includes(state)) return current
    return window.api.appUpdate.check()
  },
  ignoredVersions: () => ui.ignoredUpdateVersions,
  notify: (availableVersion) => {
    ignoreVersion.value = false
    version.value = availableVersion
  }
})

watch(
  () => ui.autoCheckUpdates && !ui.extremePlayback,
  (enabled) => {
    if (!enabled) {
      checker.stop()
      open.value = false
    }
  }
)
onMounted(() => {
  if (ui.autoCheckUpdates && !ui.extremePlayback) checker.start()
})
onBeforeUnmount(() => checker.stop())

function updateNow(): void {
  const targetVersion = version.value
  open.value = false
  ui.showPlayer = false
  void updates.downloadUpdate(targetVersion)
}
</script>

<template>
  <BaseDialog v-model="open" :title="t('settings.updateReminderTitle')" width="max-w-md">
    <p class="text-sm leading-relaxed text-text-l">
      {{ t('settings.updateReminderDescription', { version }) }}
    </p>
    <label class="mt-5 flex cursor-pointer items-center gap-2 text-sm text-text">
      <input v-model="ignoreVersion" type="checkbox" class="size-4 accent-primary" />
      {{ t('settings.ignoreUpdateVersion') }}
    </label>
    <template #footer>
      <BaseButton variant="cancel" @click="open = false">
        {{ t('settings.updateLater') }}
      </BaseButton>
      <BaseButton :disabled="updates.busy" @click="updateNow">
        {{ t('settings.updateNow') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
