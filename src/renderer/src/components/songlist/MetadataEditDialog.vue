<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'

export interface SongMetadata {
  title?: string
  artist?: string
  artists?: string[]
  album?: string
  albumArtist?: string
  trackNumber?: number | null
  trackTotal?: number | null
  discNumber?: number | null
  discTotal?: number | null
  genre?: string
  year?: number
  composer?: string
  lyricist?: string
  lyrics?: string
  comment?: string | null
  cover?: Buffer | null
  coverPath?: string
  coverMimeType?: string
  duration?: number
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  codec?: string
  container?: string
}

const props = defineProps<{
  modelValue: boolean
  songId: number | null
  coverUrl?: string | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()
const { t } = useI18n()
const { success: showSuccess, error: showError } = useMessage()

const loading = ref(false)
const saving = ref(false)
const metadata = ref<SongMetadata>({})
const originalMetadata = ref<SongMetadata>({})
const coverPreview = ref<string | null>(null)
const originalCoverUrl = ref<string | null>(null)
const newCoverPath = ref<string | null>(null)
const coverChanged = ref(false)

function cloneMetadata(src: SongMetadata): SongMetadata {
  return JSON.parse(JSON.stringify(src))
}

async function load(): Promise<void> {
  if (!props.modelValue || !props.songId) return
  loading.value = true
  metadata.value = {}
  originalMetadata.value = {}
  coverPreview.value = null
  originalCoverUrl.value = null
  newCoverPath.value = null
  coverChanged.value = false

  try {
    const response = await window.api.metadata.read(props.songId)
    if (response.success && response.data) {
      originalMetadata.value = cloneMetadata(response.data as SongMetadata)
      metadata.value = cloneMetadata(response.data as SongMetadata)
    }
  } catch {
    showError(t('metadataEdit.loadFailed'))
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.songId],
  () => {
    if (props.modelValue) {
      void load()
      originalCoverUrl.value = props.coverUrl ?? null
      coverPreview.value = props.coverUrl ?? null
    }
  },
  { immediate: true }
)

async function chooseCover(): Promise<void> {
  const response = await window.api.metadata.chooseCover?.()
  if (response && response.success && response.data) {
    const { filePath, dataUrl } = response.data as { filePath: string; dataUrl: string }
    newCoverPath.value = filePath
    coverPreview.value = dataUrl
    coverChanged.value = true
  }
}

function removeCover(): void {
  newCoverPath.value = null
  coverPreview.value = originalCoverUrl.value
  coverChanged.value = false
}

async function handleSave(): Promise<void> {
  if (!props.songId) return
  saving.value = true
  try {
    const payload: SongMetadata = {}
    const orig = originalMetadata.value
    const curr = metadata.value

    if (curr.title !== orig.title) payload.title = curr.title
    if (curr.artist !== orig.artist) payload.artist = curr.artist
    if (curr.album !== orig.album) payload.album = curr.album
    if (curr.albumArtist !== orig.albumArtist) payload.albumArtist = curr.albumArtist
    if (curr.year !== orig.year) payload.year = curr.year
    if (curr.trackNumber !== orig.trackNumber) payload.trackNumber = curr.trackNumber
    if (curr.discNumber !== orig.discNumber) payload.discNumber = curr.discNumber
    if (curr.genre !== orig.genre) payload.genre = curr.genre
    if (curr.composer !== orig.composer) payload.composer = curr.composer
    if (curr.lyricist !== orig.lyricist) payload.lyricist = curr.lyricist
    if (curr.lyrics !== orig.lyrics) payload.lyrics = curr.lyrics

    if (newCoverPath.value) {
      payload.coverPath = newCoverPath.value
    }

    const response = await window.api.metadata.write(props.songId, payload)
    if (response.success) {
      showSuccess(t('metadataEdit.saveSuccess'))
      emit('update:modelValue', false)
      emit('saved')
    } else {
      showError(response.error || t('metadataEdit.saveFailed'))
    }
  } catch {
    showError(t('metadataEdit.saveFailed'))
  } finally {
    saving.value = false
  }
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

const inputLabelClass = 'mb-1 text-xs text-text-l'
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('metadataEdit.dialogTitle')"
    width="max-w-4xl"
    :close-on-overlay="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="loading" class="py-8 text-center text-sm text-text-l">
      {{ t('metadataEdit.loading') }}
    </p>
    <div v-else class="flex gap-6 p-2">
      <!-- Left: cover + lyrics -->
      <div class="shrink-0 w-40">
        <div class="relative w-40 h-40">
          <img
            v-if="coverPreview"
            :src="coverPreview"
            class="w-40 h-40 object-cover rounded-xl shadow-lg"
            alt=""
          />
          <div v-else class="w-40 h-40 rounded-xl bg-bg-l flex items-center justify-center">
            <span class="text-4xl text-text-l">♪</span>
          </div>
          <button
            v-if="coverChanged || newCoverPath"
            class="absolute top-1 right-1 bg-black/40 rounded-full w-6 h-6 flex items-center justify-center text-white text-xs hover:bg-black/60"
            @click="removeCover"
          >
            ✕
          </button>
        </div>
        <button
          class="px-3 py-1 mt-2 rounded bg-primary hover:opacity-85 text-white cursor-pointer text-sm w-full text-center"
          @click="chooseCover"
        >
          {{ t('metadataEdit.chooseCover') }}
        </button>
        <div class="mt-4 w-40">
          <div :class="inputLabelClass">{{ t('metadataEdit.lyrics') }}</div>
          <textarea
            v-model="metadata.lyrics"
            class="w-full h-24 py-1 px-2 rounded border border-border text-sm bg-transparent outline-none focus:border-primary resize-none"
          />
        </div>
      </div>

      <!-- Middle column -->
      <div class="flex-1 flex flex-col gap-3">
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.title') }}</div>
          <BaseInput v-model="metadata.title" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.artist') }}</div>
          <BaseInput v-model="metadata.artist" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.album') }}</div>
          <BaseInput v-model="metadata.album" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.year') }}</div>
          <BaseInput v-model="metadata.year" :clearable="false" type="number" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.trackNumber') }}</div>
          <BaseInput v-model="metadata.trackNumber" :clearable="false" type="number" />
        </div>
      </div>

      <!-- Right column -->
      <div class="flex-1 flex flex-col gap-3">
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.albumArtist') }}</div>
          <BaseInput v-model="metadata.albumArtist" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.composer') }}</div>
          <BaseInput v-model="metadata.composer" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.lyricist') }}</div>
          <BaseInput v-model="metadata.lyricist" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.genre') }}</div>
          <BaseInput v-model="metadata.genre" :clearable="false" />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.discNumber') }}</div>
          <BaseInput v-model="metadata.discNumber" :clearable="false" type="number" />
        </div>
      </div>
    </div>
    <template #footer>
      <BaseButton variant="secondary" @click="emit('update:modelValue', false)">
        {{ t('metadataEdit.cancel') }}
      </BaseButton>
      <BaseButton :disabled="saving" @click="handleSave">
        {{ saving ? t('metadataEdit.saving') : t('metadataEdit.save') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
