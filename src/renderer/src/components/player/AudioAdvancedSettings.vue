<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMessage } from '@/components/ui/useMessage'
import { audioBridge } from '@/services/audioBridge'
import { usePlayerStore } from '@/stores/player/playerStore'
import { audioProcessingProfileNameLimit } from '../../../../shared/audioProcessingProfiles'

type DialogAction = 'save' | 'delete' | 'reset' | 'restart'
type Action = 'apply' | DialogAction

const emit = defineEmits<{ processingChanged: [] }>()
const { t } = useI18n()
const { success, warning } = useMessage()
const player = usePlayerStore()
const profileName = ref('')
const selectedProfile = ref('')
const profiles = ref<string[]>([])
const profileOptions = computed(() => profiles.value.map((name) => ({ value: name, label: name })))
const pending = ref<Action | 'load' | null>(null)
const dialogAction = ref<DialogAction>('save')
const profileToDelete = ref('')
const actionDialogOpen = ref(false)

const dialogLabels = {
  save: { title: 'saveAudioProfile', description: '' },
  delete: { title: 'deleteAudioProfile', description: 'deleteAudioProfileConfirm' },
  reset: { title: 'resetAudioSettings', description: 'resetAudioSettingsConfirm' },
  restart: { title: 'restartAudioEngine', description: 'restartAudioEngineConfirm' }
}

function openActionDialog(action: DialogAction): void {
  dialogAction.value = action
  if (action === 'save') profileName.value = ''
  if (action === 'delete') profileToDelete.value = selectedProfile.value
  actionDialogOpen.value = true
}

const stepLabels: Record<string, string> = {
  preamp: 'preamp',
  'DSP nodes': 'dspNode',
  ReplayGain: 'replayGain',
  'playback speed': 'playSpeed',
  EQ: 'eq',
  compressor: 'compressor',
  delay: 'delay',
  reverb: 'reverb',
  chorus: 'chorus',
  'noise gate': 'noiseGate',
  phaser: 'phaser',
  'channel matrix': 'channelMatrix',
  'stereo field': 'stereoField',
  crossfeed: 'crossfeed',
  'impulse response': 'irCorrection',
  limiter: 'limiter',
  resampler: 'resampler',
  DoP: 'enableDoP',
  transition: 'transitionSettings'
}

const errorLabels: Record<string, string> = {
  'Audio engine unavailable': 'resetEngineUnavailable',
  invalid_profile_name: 'audioProfileInvalidName',
  profile_name_exists: 'audioProfileNameExists',
  profile_not_found: 'audioProfileNotFound',
  playback_busy: 'audioPlaybackBusy',
  restart_unavailable: 'audioRestartUnavailable',
  restart_settings_failed: 'audioRestartSettingsFailed'
}

function failureReason(error?: string): string {
  const step = error?.match(/^Failed to apply (.+) (?:defaults|profile)$/)?.[1]
  if (step && stepLabels[step])
    return t(`ap.audioProcessingStepFailed`, { step: t(`ap.${stepLabels[step]}`) })
  return t(`ap.${(error && errorLabels[error]) || 'resetUnknownError'}`)
}

const messages = {
  save: { success: 'audioProfileSaved', error: 'audioProfileSaveFailed' },
  apply: { success: 'audioProfileApplied', error: 'audioProfileApplyFailed' },
  delete: { success: 'audioProfileDeleted', error: 'audioProfileDeleteFailed' },
  reset: { success: 'resetAudioSettingsDone', error: 'resetAudioSettingsFailed' },
  restart: { success: 'audioEngineRestarted', error: 'audioEngineRestartFailed' }
}

onMounted(async () => {
  pending.value = 'load'
  try {
    const result = await audioBridge.listAudioProcessingProfiles()
    if (!result.success) throw new Error(result.error)
    profiles.value = result.data ?? []
    selectedProfile.value = profiles.value[0] ?? ''
  } catch {
    warning(t('ap.audioProfileListFailed'))
  } finally {
    pending.value = null
  }
})

async function run(action: Action): Promise<void> {
  if (pending.value) return
  const name =
    action === 'save'
      ? profileName.value.trim()
      : action === 'delete'
        ? profileToDelete.value
        : selectedProfile.value
  if ((action === 'save' || action === 'apply' || action === 'delete') && !name) return
  pending.value = action
  try {
    const actions = {
      save: () => audioBridge.saveAudioProcessingProfile(name),
      apply: () => player.applyAudioProcessingProfile(name),
      delete: () => audioBridge.deleteAudioProcessingProfile(name),
      reset: () => player.resetAudioProcessingSettings(),
      restart: () => player.restartAudioEngine()
    }
    const result = await actions[action]()
    if (!result.success) {
      warning(t(`ap.${messages[action].error}`, { reason: failureReason(result.error) }))
      return
    }
    if (action === 'save') {
      profiles.value.push(name)
      selectedProfile.value = name
      profileName.value = ''
    }
    if (action === 'delete') {
      profiles.value = profiles.value.filter((profile) => profile !== name)
      selectedProfile.value = profiles.value[0] ?? ''
    }
    if (action === 'apply' || action === 'reset') emit('processingChanged')
    actionDialogOpen.value = false
    success(t(`ap.${messages[action].success}`, { name }))
  } catch {
    warning(t(`ap.${messages[action].error}`, { reason: failureReason() }))
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <div>
        <h4 class="text-sm font-semibold">{{ t('ap.audioProcessingProfiles') }}</h4>
        <p class="mt-1 text-xs text-text-l">{{ t('ap.audioProcessingProfilesDesc') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-text-l">{{ t('ap.savedAudioProfiles') }}</span>
        <BaseSelect
          v-model="selectedProfile"
          class="w-44"
          :options="profileOptions"
          :placeholder="t('ap.noAudioProfiles')"
          :aria-label="t('ap.savedAudioProfiles')"
          :disabled="!!pending || !profiles.length"
        />
        <BaseButton
          size="sm"
          variant="secondary"
          :disabled="!!pending"
          @click="openActionDialog('save')"
        >
          {{ t('ap.saveAudioProfile') }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="secondary"
          :loading="pending === 'apply'"
          :disabled="!!pending || !selectedProfile"
          @click="run('apply')"
        >
          {{ t('ap.applyAudioProfile') }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="danger"
          :disabled="!!pending || !selectedProfile"
          @click="openActionDialog('delete')"
        >
          {{ t('ap.deleteAudioProfile') }}
        </BaseButton>
      </div>
    </section>

    <section class="space-y-3">
      <h4 class="text-sm font-semibold">{{ t('ap.audioEngineMaintenance') }}</h4>
      <div class="flex flex-wrap items-center gap-2">
        <BaseButton variant="danger" :disabled="!!pending" @click="openActionDialog('restart')">
          <template #left><SvgIcon name="common-refresh" class-name="size-4" /></template>
          {{ t('ap.restartAudioEngine') }}
        </BaseButton>
        <BaseButton variant="danger" :disabled="!!pending" @click="openActionDialog('reset')">
          <template #left><SvgIcon name="common-refresh" class-name="size-4" /></template>
          {{ t('ap.resetAudioSettings') }}
        </BaseButton>
      </div>
    </section>

    <BaseDialog
      :model-value="actionDialogOpen"
      :title="t(`ap.${dialogLabels[dialogAction].title}`)"
      width="max-w-sm"
      @update:model-value="
        (open) => {
          if (!pending) actionDialogOpen = open
        }
      "
    >
      <div v-if="dialogAction === 'save'">
        <label for="audio-profile-name" class="block text-sm">{{ t('ap.audioProfileName') }}</label>
        <BaseInput
          id="audio-profile-name"
          v-model="profileName"
          class="mt-2 w-full"
          :maxlength="audioProcessingProfileNameLimit"
          :disabled="!!pending"
          @keyup.enter="run('save')"
        />
      </div>
      <p v-else class="text-sm">
        {{ t(`ap.${dialogLabels[dialogAction].description}`, { name: profileToDelete }) }}
      </p>
      <template #footer>
        <BaseButton variant="cancel" :disabled="!!pending" @click="actionDialogOpen = false">
          {{ t('common.cancel') }}
        </BaseButton>
        <BaseButton
          :variant="dialogAction === 'save' ? 'primary' : 'danger'"
          :loading="!!pending"
          :disabled="dialogAction === 'save' && !profileName.trim()"
          @click="run(dialogAction)"
        >
          <template v-if="dialogAction === 'restart' || dialogAction === 'reset'" #left>
            <SvgIcon name="common-refresh" class-name="size-4" />
          </template>
          {{ t(`ap.${dialogLabels[dialogAction].title}`) }}
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
