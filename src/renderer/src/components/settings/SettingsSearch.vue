<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import {
  createSettingsSearchTranslator,
  indexSettings,
  searchSettings,
  type SettingsSearchEntry
} from '@/utils/settingsSearch'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ root: HTMLElement | null }>()
const emit = defineEmits<{ select: [entry: SettingsSearchEntry] }>()
const { t, locale, availableLocales, getLocaleMessage } = useI18n()
const query = ref('')
const input = ref<InstanceType<typeof BaseInput> | null>(null)
const entries = shallowRef<SettingsSearchEntry[]>([])
const results = computed(() => searchSettings(entries.value, query.value))
const translate = computed(() =>
  createSettingsSearchTranslator(availableLocales.map(getLocaleMessage))
)
let observer: MutationObserver | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let selected: SettingsSearchEntry | undefined

function refresh(): void {
  if (open.value && props.root) entries.value = indexSettings(props.root, translate.value)
}
function stop(): void {
  observer?.disconnect()
  observer = undefined
  clearTimeout(refreshTimer)
}
watch(
  [open, locale, () => props.root, translate],
  async (_value, _previous, onCleanup) => {
    stop()
    let cancelled = false
    onCleanup(() => {
      cancelled = true
      stop()
    })
    if (!open.value) return
    selected = undefined
    await nextTick()
    if (cancelled || !open.value || !props.root) return
    refresh()
    await nextTick()
    if (cancelled || !open.value) return
    input.value?.focus()
    observer = new MutationObserver(() => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refresh, 80)
    })
    observer.observe(props.root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'style']
    })
  },
  { flush: 'post' }
)
onBeforeUnmount(stop)

function choose(entry?: SettingsSearchEntry): void {
  if (!entry) return
  selected = entry
  open.value = false
}
function afterLeave(): void {
  if (selected) emit('select', selected)
  selected = undefined
}
function focusResult(index: number): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.settings-search-result')
  buttons[(index + buttons.length) % buttons.length]?.focus()
}
function inputKey(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter' && results.value.length) {
    event.preventDefault()
    choose(results.value[0])
  } else if (event.key === 'ArrowDown' && results.value.length) {
    event.preventDefault()
    focusResult(0)
  }
}
</script>

<template>
  <BaseDialog
    v-model="open"
    :title="t('settings.searchTitle')"
    width="max-w-2xl"
    @after-enter="input?.focus()"
    @after-leave="afterLeave"
  >
    <BaseInput
      ref="input"
      v-model="query"
      type="search"
      :placeholder="t('settings.searchPlaceholder')"
      :aria-label="t('settings.searchTitle')"
      class="w-full"
      @keydown="inputKey"
    >
      <template #prefix><SvgIcon name="common-search" class-name="size-4 text-text-l" /></template>
    </BaseInput>
    <p class="mt-3 text-xs text-text-l" role="status" aria-live="polite">
      {{
        query.trim()
          ? t('settings.searchResultCount', { count: results.length })
          : t('settings.searchHint')
      }}
    </p>
    <div class="custom-scrollbar mt-2 max-h-[55vh] overflow-y-auto">
      <ul v-if="results.length" class="space-y-0.5">
        <li v-for="(entry, index) in results" :key="entry.id">
          <button
            type="button"
            class="settings-search-result w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            @click="choose(entry)"
            @keydown.down.prevent="focusResult(index + 1)"
            @keydown.up.prevent="index ? focusResult(index - 1) : input?.focus()"
          >
            <span
              v-if="entry.path.length"
              class="mb-0.5 block truncate text-xs leading-4 text-text-l"
            >
              {{ entry.path.join(' › ') }}
            </span>
            <span class="block text-sm font-medium text-text">{{ entry.title }}</span>
            <span
              v-if="entry.description"
              class="mt-0.5 line-clamp-1 text-xs leading-4 text-text-l"
            >
              {{ entry.description }}
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="query.trim()" class="py-8 text-center text-sm text-text-l">
        {{ t('settings.searchEmpty') }}
      </p>
    </div>
  </BaseDialog>
</template>
