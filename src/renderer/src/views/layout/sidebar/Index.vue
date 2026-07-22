<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import CreatePlaylistDialog from '@/components/playlist/CreatePlaylistDialog.vue'
import eventBus from '@/utils/eventBus'
import { useMessage } from '@/components/ui/useMessage'

interface NavigationItem {
  labelKey: string
  path: string
  icon: string
}
interface Playlist {
  id: number
  name: string
  cover: string | null
  position: number
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const expanded = ref(true)
const playlistsExpanded = ref(true)
const playlists = ref<Playlist[]>([])
const playlistDialogOpen = ref(false)
const draggedPlaylistId = ref<number | null>(null)
const { success, error: showError } = useMessage()

const libraryItems: NavigationItem[] = [
  { labelKey: 'nav.home', path: '/home', icon: 'menu-home' },
  { labelKey: 'nav.songs', path: '/song', icon: 'menu-song' },
  { labelKey: 'nav.artists', path: '/artist', icon: 'menu-artist' },
  { labelKey: 'nav.albums', path: '/album', icon: 'menu-album' },
  { labelKey: 'nav.genres', path: '/genre', icon: 'menu-genre' },
  { labelKey: 'nav.localFiles', path: '/local', icon: 'menu-folder' },
  { labelKey: 'nav.remoteFiles', path: '/remote', icon: 'menu-remote' }
]

const utilityItems: NavigationItem[] = [
  { labelKey: 'nav.history', path: '/history', icon: 'menu-history' },
  { labelKey: 'nav.developer', path: '/dev', icon: 'menu-dev' },
  { labelKey: 'nav.settings', path: '/settings', icon: 'menu-settings' }
]

const activePath = computed(() => route.path)
const navItemClass =
  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-text-l transition-colors hover:bg-hover hover:text-text'

function isActive(path: string): boolean {
  return activePath.value === path || activePath.value.startsWith(`${path}/`)
}

function navigate(item: NavigationItem): void {
  if (route.path !== item.path) void router.push(item.path)
}

async function loadPlaylists(): Promise<void> {
  const response = await window.api.database.command('listPlaylists')
  if (response.success) playlists.value = response.data as Playlist[]
}
function createPlaylist(): void {
  playlistDialogOpen.value = true
}
function playlistCover(cover: string | null): string | null {
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}
function openPlaylist(id: number): void {
  void router.push(`/playlist/${id}`)
}
async function dropPlaylist(targetId: number): Promise<void> {
  const sourceId = draggedPlaylistId.value
  draggedPlaylistId.value = null
  if (!sourceId || sourceId === targetId) return
  const sourceIndex = playlists.value.findIndex((item) => item.id === sourceId)
  const targetIndex = playlists.value.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [moved] = playlists.value.splice(sourceIndex, 1)
  playlists.value.splice(targetIndex, 0, moved)
  const response = await window.api.database.command('reorderPlaylists', {
    items: playlists.value.map((item, position) => ({ id: item.id, position }))
  })
  if (response.success) {
    eventBus.emit('playlistsChanged')
    success(t('sidebar.playlistReordered'))
  } else {
    showError(response.error || t('sidebar.playlistReorderFailed'))
    await loadPlaylists()
  }
}
onMounted(() => {
  void loadPlaylists()
  eventBus.on('playlistsChanged', loadPlaylists)
})
onBeforeUnmount(() => eventBus.off('playlistsChanged', loadPlaylists))
</script>

<template>
  <aside
    class="flex h-full flex-col overflow-hidden border-r border-border text-text transition-[width] duration-200"
    :class="expanded ? 'w-54' : 'w-14'"
  >
    <nav
      class="no-scrollbar flex-1 overflow-y-auto px-2 py-2"
      :aria-label="t('sidebar.ariaLabel')"
    >
      <section class="pb-3">
        <div
          class="mb-1 flex h-8 items-center px-2"
          :class="expanded ? 'justify-between' : 'justify-center'"
        >
          <p v-if="expanded" class="text-[11px] font-semibold tracking-[0.08em] text-text-l">
            {{ t('sidebar.library') }}
          </p>
          <button
            class="grid size-7 place-items-center rounded-md text-text-l transition-colors hover:bg-hover hover:text-text"
            :title="expanded ? t('sidebar.collapse') : t('sidebar.expand')"
            @click="expanded = !expanded"
          >
            <SvgIcon
              name="arrow-arrow-left-thin"
              class-name="h-4 w-4 transition-transform duration-200"
              :class="{ 'rotate-180': !expanded }"
            />
          </button>
        </div>
        <button
          v-for="item in libraryItems"
          :key="item.path"
          :class="[
            navItemClass,
            isActive(item.path)
              ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] font-semibold text-primary'
              : '',
            !expanded ? 'justify-center px-0' : ''
          ]"
          :title="expanded ? undefined : t(item.labelKey)"
          @click="navigate(item)"
        >
          <SvgIcon :name="item.icon" class-name="size-5 shrink-0" />
          <span v-if="expanded" class="truncate">{{ t(item.labelKey) }}</span>
        </button>
      </section>

      <section class="border-t border-border py-3">
        <div v-if="expanded" class="mb-1 flex items-center justify-between px-2">
          <p class="text-[11px] font-semibold tracking-[0.08em] text-text-l">
            {{ t('sidebar.playlists') }}
          </p>
          <div class="flex items-center gap-1">
            <button
              class="grid size-6 place-items-center rounded-md text-text-l hover:bg-hover hover:text-text"
              :title="
                playlistsExpanded ? t('sidebar.collapsePlaylists') : t('sidebar.expandPlaylists')
              "
              @click="playlistsExpanded = !playlistsExpanded"
            >
              <SvgIcon
                :name="playlistsExpanded ? 'common-expand-up' : 'common-expand-down'"
                class-name="size-4"
              />
            </button>
            <button
              class="grid size-6 place-items-center rounded-md text-text-l hover:bg-hover hover:text-text"
              :title="t('sidebar.createPlaylist')"
              @click="createPlaylist"
            >
              <SvgIcon name="common-plus" class-name="size-4" />
            </button>
          </div>
        </div>
        <template v-else>
          <button
            :class="[navItemClass, 'justify-center px-0']"
            :title="t('sidebar.createPlaylist')"
            @click="createPlaylist"
          >
            <SvgIcon name="common-plus" class-name="size-5 shrink-0" />
          </button>
          <div v-if="playlists.length" class="mt-1 space-y-0.5">
            <button
              v-for="playlist in playlists"
              :key="playlist.id"
              draggable="true"
              class="grid h-9 w-full place-items-center rounded-lg transition-colors hover:bg-hover"
              :class="
                isActive(`/playlist/${playlist.id}`)
                  ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] text-primary'
                  : 'text-text-l'
              "
              :title="playlist.name"
              @click="openPlaylist(playlist.id)"
              @dragstart="draggedPlaylistId = playlist.id"
              @dragover.prevent
              @drop.prevent="dropPlaylist(playlist.id)"
            >
              <img
                v-if="playlistCover(playlist.cover)"
                :src="playlistCover(playlist.cover)!"
                class="size-5 rounded object-cover"
                :alt="playlist.name"
              />
              <span v-else class="grid size-5 place-items-center rounded bg-bg-l"
                ><SvgIcon name="common-music" class-name="size-3"
              /></span>
              <span class="sr-only">{{ playlist.name }}</span>
            </button>
          </div>
        </template>
        <div v-if="expanded && playlistsExpanded && playlists.length" class="space-y-0.5">
          <button
            v-for="playlist in playlists"
            :key="playlist.id"
            draggable="true"
            class="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-text-l transition-colors hover:bg-hover hover:text-text"
            :class="
              isActive(`/playlist/${playlist.id}`)
                ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] font-semibold text-primary'
                : ''
            "
            @click="openPlaylist(playlist.id)"
            @dragstart="draggedPlaylistId = playlist.id"
            @dragover.prevent
            @drop.prevent="dropPlaylist(playlist.id)"
          >
            <img
              v-if="playlistCover(playlist.cover)"
              :src="playlistCover(playlist.cover)!"
              class="size-5 rounded object-cover"
              :alt="playlist.name"
            />
            <span v-else class="grid size-5 place-items-center rounded bg-bg-l"
              ><SvgIcon name="common-music" class-name="size-3"
            /></span>
            <span class="truncate">{{ playlist.name }}</span>
          </button>
        </div>
        <p
          v-else-if="expanded && playlistsExpanded"
          class="px-2 pt-1 text-xs leading-5 text-text-l"
        >
          {{ t('sidebar.playlistEmpty') }}
        </p>
      </section>

      <section class="border-t border-border pt-3">
        <p
          v-if="expanded"
          class="mb-1 px-2 text-[11px] font-semibold tracking-[0.08em] text-text-l"
        >
          {{ t('sidebar.more') }}
        </p>
        <button
          v-for="item in utilityItems"
          :key="item.path"
          :class="[
            navItemClass,
            isActive(item.path)
              ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] font-semibold text-primary'
              : '',
            !expanded ? 'justify-center px-0' : ''
          ]"
          :title="expanded ? undefined : t(item.labelKey)"
          @click="navigate(item)"
        >
          <SvgIcon :name="item.icon" class-name="size-5 shrink-0" />
          <span v-if="expanded" class="truncate">{{ t(item.labelKey) }}</span>
        </button>
      </section>
      <div class="h-24" />
    </nav>
  </aside>
  <CreatePlaylistDialog v-model="playlistDialogOpen" />
</template>
