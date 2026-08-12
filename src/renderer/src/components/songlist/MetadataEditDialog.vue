<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'
import CropperDialog from '@/components/cropper/CropperDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

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
  coverDataUrl?: string
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
const rawCoverDataUrl = ref<string | null>(null)
const cropDialogVisible = ref(false)
const coverSearchDialogVisible = ref(false)
const coverSearch = ref('')
const coverResults = ref<
  Array<{
    id: string
    title: string
    artist: string
    album: string
    imageUrl: string
    previewUrl: string
  }>
>([])
const searchingCovers = ref(false)

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
    await prepareCrop(dataUrl)
  }
}

async function prepareCrop(dataUrl: string): Promise<void> {
  rawCoverDataUrl.value = dataUrl
  coverChanged.value = true
  cropDialogVisible.value = true
}

function applyCrop(dataUrl: string): void {
  coverPreview.value = dataUrl
}

async function searchCovers(): Promise<void> {
  const title = coverSearch.value.trim() || metadata.value.title || ''
  if (!title) return
  searchingCovers.value = true
  try {
    const response = await window.api.metadata.searchCovers({
      title,
      artist: metadata.value.artist,
      album: metadata.value.album
    })
    coverResults.value = response.success ? (response.data ?? []) : []
  } finally {
    searchingCovers.value = false
  }
}

async function openCoverSearch(): Promise<void> {
  coverSearch.value = [metadata.value.title, metadata.value.artist, metadata.value.album]
    .filter(Boolean)
    .join(' ')
  coverResults.value = []
  coverSearchDialogVisible.value = true
  await searchCovers()
}

async function selectNetworkCover(imageUrl: string): Promise<void> {
  try {
    const response = await window.api.metadata.downloadCover(imageUrl)
    if (!response.success || !response.data) {
      showError(response.error || t('metadataEdit.coverSetFailed'))
      return
    }
    newCoverPath.value = null
    coverSearchDialogVisible.value = false
    await prepareCrop(response.data.dataUrl)
  } catch {
    showError(t('metadataEdit.coverSetFailed'))
  }
}

function removeCover(): void {
  newCoverPath.value = null
  rawCoverDataUrl.value = null
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

    if (coverChanged.value && coverPreview.value?.startsWith('data:image/')) {
      payload.coverDataUrl = coverPreview.value
    } else if (newCoverPath.value) {
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
        <div class="mt-2 flex gap-1">
          <BaseButton class="min-w-0 flex-1" @click="chooseCover">{{
            t('metadataEdit.chooseCover')
          }}</BaseButton>
          <button
            class="grid h-9 px-1 shrink-0 place-items-center rounded text-white hover:opacity-85 disabled:opacity-50"
            :aria-label="t('metadataEdit.searchCover')"
            :title="t('metadataEdit.searchCover')"
            :disabled="searchingCovers"
            @click="openCoverSearch"
          >
            <svg-icon name="common-search" class-name="size-4" />
          </button>
        </div>
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
          <BaseInput
            :model-value="metadata.year ?? ''"
            :clearable="false"
            type="number"
            @update:model-value="metadata.year = $event === '' ? undefined : Number($event)"
          />
        </div>
        <div>
          <div :class="inputLabelClass">{{ t('metadataEdit.trackNumber') }}</div>
          <BaseInput
            :model-value="metadata.trackNumber ?? ''"
            :clearable="false"
            type="number"
            @update:model-value="metadata.trackNumber = $event === '' ? null : Number($event)"
          />
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
          <BaseInput
            :model-value="metadata.discNumber ?? ''"
            :clearable="false"
            type="number"
            @update:model-value="metadata.discNumber = $event === '' ? null : Number($event)"
          />
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
  <CropperDialog
    v-model="cropDialogVisible"
    :image-url="rawCoverDataUrl"
    :size="1000"
    @confirm="applyCrop"
  />
  <BaseDialog
    :model-value="coverSearchDialogVisible"
    :title="t('metadataEdit.searchCover')"
    width="max-w-xl"
    @update:model-value="coverSearchDialogVisible = $event"
  >
    <div class="p-2">
      <div class="flex gap-2">
        <BaseInput
          v-model="coverSearch"
          :placeholder="t('metadataEdit.searchCoverPlaceholder')"
          :clearable="false"
          @keyup.enter="searchCovers"
        />
        <BaseButton :disabled="searchingCovers" class="text-nowrap" @click="searchCovers">
          <svg-icon name="common-search" class-name="size-[14px] mr-1" />
          {{ t('metadataEdit.searchCover') }}
        </BaseButton>
      </div>
      <div v-if="coverResults.length" class="mt-4 grid grid-cols-4 gap-3">
        <button
          v-for="result in coverResults"
          :key="result.id"
          class="overflow-hidden rounded-lg border border-border text-left hover:border-primary"
          :title="[result.title, result.artist].filter(Boolean).join(' · ')"
          @click="selectNetworkCover(result.imageUrl)"
        >
          <img
            :src="result.previewUrl"
            class="aspect-square w-full object-cover"
            :alt="result.title"
          />
          <span class="block truncate px-2 py-1 text-xs">{{ result.title }}</span>
          <span class="block truncate px-2 pb-2 text-[11px] text-text-l">{{ result.artist }}</span>
        </button>
      </div>
      <p v-else-if="!searchingCovers" class="mt-4 text-center text-sm text-text-l">
        {{ t('metadataEdit.searchCoverEmpty') }}
      </p>
    </div>
  </BaseDialog>
</template>
