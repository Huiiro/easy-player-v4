<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import CreatePlaylistDialog from '@/components/playlist/CreatePlaylistDialog.vue'
import RenamePlaylistDialog from '@/components/playlist/RenamePlaylistDialog.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import eventBus from '@/utils/eventBus'
import { useMessage } from '@/components/ui/useMessage'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import type { PagedLibrarySongs } from '@/types/library'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'

interface NavigationItem {
  labelKey: string
  path: string
  icon: string
}
interface Playlist {
  id: number
  name: string
  cover: string | null
  description: string | null
  position: number
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const { sidebarExpanded: expanded, sidebarPlaylistsExpanded: playlistsExpanded } =
  storeToRefs(useUIStore())
const playlists = ref<Playlist[]>([])
const playlistDialogOpen = ref(false)
const draggedPlaylistId = ref<number | null>(null)
const menuPlaylist = ref<Playlist | null>(null)
const menuPosition = ref({ left: 0, top: 0 })
const menuRef = ref<HTMLElement | null>(null)
const deletePlaylistTarget = ref<Playlist | null>(null)
const renamePlaylistTarget = ref<Playlist | null>(null)
const renameDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const deletingPlaylist = ref(false)
const playingPlaylistId = ref<number | null>(null)
let menuTrigger: HTMLButtonElement | null = null
const { success, warning, error: showError } = useMessage()

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
  { labelKey: 'nav.recommend', path: '/recommend', icon: 'control-shuffle' },
  { labelKey: 'nav.history', path: '/history', icon: 'menu-history' },
  { labelKey: 'nav.download', path: '/download', icon: 'menu-download' },
  { labelKey: 'nav.settings', path: '/settings', icon: 'menu-settings' },
  ...(import.meta.env.DEV ? [{ labelKey: 'nav.developer', path: '/dev', icon: 'menu-dev' }] : [])
]

const activePath = computed(() => route.path)
const navItemClass =
  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-text-l transition-colors hover:bg-hover hover:text-text'

function isActive(path: string): boolean {
  return activePath.value === path || activePath.value.startsWith(`${path}/`)
}

function isPlayingPlaylist(id: number): boolean {
  return player.isPlaying && player.queuePlaylistId === id
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
  closePlaylistMenu()
  void router.push(`/playlist/${id}`)
}
function closePlaylistMenu(): void {
  menuPlaylist.value = null
  menuTrigger = null
}
function openPlaylistMenu(playlist: Playlist, event: MouseEvent): void {
  event.preventDefault()
  menuPosition.value = {
    left: Math.max(8, Math.min(event.clientX, window.innerWidth - 184)),
    top: Math.max(8, Math.min(event.clientY, window.innerHeight - 136))
  }
  menuTrigger = (event.target as HTMLElement).closest('button')
  menuPlaylist.value = playlist
  void nextTick(() => menuRef.value?.querySelector<HTMLButtonElement>('button')?.focus())
}
function handleOutsidePointer(event: PointerEvent): void {
  const target = event.target as Node
  if (menuRef.value?.contains(target) || menuTrigger?.contains(target)) return
  closePlaylistMenu()
}
function handleMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    menuTrigger?.focus()
    closePlaylistMenu()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const buttons = Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[
      (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    ]?.focus()
  }
}
async function playPlaylist(playlist: Playlist): Promise<void> {
  if (playingPlaylistId.value !== null) return
  closePlaylistMenu()
  playingPlaylistId.value = playlist.id
  try {
    const response = await window.api.database.command('queryPlaylistSongs', {
      playlistId: playlist.id,
      query: {}
    })
    if (!response.success) {
      showError(response.error || t('playlist.playFailed'))
      return
    }
    const songs = (response.data as PagedLibrarySongs).data.filter((song) => song.songStatus !== 0)
    if (!songs.length) {
      warning(t('playlist.empty'))
      return
    }
    if (!(await player.playCollection(songs, songs[0].id, playlist.id)))
      showError(t('playlist.playFailed'))
  } finally {
    playingPlaylistId.value = null
  }
}
function confirmDeletePlaylist(playlist: Playlist): void {
  closePlaylistMenu()
  deletePlaylistTarget.value = playlist
  deleteDialogOpen.value = true
}
function renamePlaylist(playlist: Playlist): void {
  closePlaylistMenu()
  renamePlaylistTarget.value = playlist
  renameDialogOpen.value = true
}
async function deletePlaylist(): Promise<void> {
  const playlist = deletePlaylistTarget.value
  if (!playlist || deletingPlaylist.value) return
  deletingPlaylist.value = true
  try {
    const response = await window.api.database.command('deletePlaylists', { ids: [playlist.id] })
    if (!response.success) {
      showError(response.error || t('playlist.deleteFailed'))
      return
    }
    deleteDialogOpen.value = false
    deletePlaylistTarget.value = null
    eventBus.emit('playlistsChanged')
    success(t('playlist.deleted'))
    if (route.path === `/playlist/${playlist.id}`) await router.replace('/song')
  } finally {
    deletingPlaylist.value = false
  }
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
  document.addEventListener('pointerdown', handleOutsidePointer)
  window.addEventListener('resize', closePlaylistMenu)
})
onBeforeUnmount(() => {
  eventBus.off('playlistsChanged', loadPlaylists)
  document.removeEventListener('pointerdown', handleOutsidePointer)
  window.removeEventListener('resize', closePlaylistMenu)
})
</script>

<template>
  <aside
    class="app-sidebar flex h-full flex-col overflow-hidden border-r border-border text-text transition-[width] duration-[var(--motion-duration-standard)]"
    :class="expanded ? 'w-54' : 'w-14'"
  >
    <nav
      class="no-scrollbar flex-1 overflow-y-auto px-2 py-2"
      :aria-label="t('sidebar.ariaLabel')"
      @scroll="closePlaylistMenu"
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
              class-name="h-4 w-4 transition-transform duration-[var(--motion-duration-standard)]"
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
        <template v-if="!expanded">
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
              class="relative grid h-9 w-full place-items-center rounded-lg transition-colors hover:bg-hover"
              :class="
                isActive(`/playlist/${playlist.id}`)
                  ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] text-primary'
                  : 'text-text-l'
              "
              :title="
                isPlayingPlaylist(playlist.id)
                  ? `${playlist.name} · ${t('sidebar.playing')}`
                  : playlist.name
              "
              @click="openPlaylist(playlist.id)"
              @dragstart="draggedPlaylistId = playlist.id"
              @dragover.prevent
              @drop.prevent="dropPlaylist(playlist.id)"
              @contextmenu.prevent="openPlaylistMenu(playlist, $event)"
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
              <span
                v-if="isPlayingPlaylist(playlist.id)"
                class="absolute bottom-1 right-1 size-1.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span class="sr-only">{{ playlist.name }}</span>
              <span v-if="isPlayingPlaylist(playlist.id)" class="sr-only">
                {{ t('sidebar.playing') }}
              </span>
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
            @contextmenu.prevent="openPlaylistMenu(playlist, $event)"
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
            <span class="min-w-0 flex-1 truncate">{{ playlist.name }}</span>
            <span
              v-if="isPlayingPlaylist(playlist.id)"
              class="shrink-0 text-[10px] font-medium text-primary"
            >
              {{ t('sidebar.playing') }}
            </span>
          </button>
        </div>
      </section>

      <section class="border-t border-border pt-3">
        <p
          v-if="expanded"
          class="mb-1 px-2 text-[11px] font-semibold tracking-[0.08em] text-text-l"
        >
          {{ t('sidebar.more') }}
        </p>
        <button
          :class="[
            navItemClass,
            isActive('/liked')
              ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] font-semibold text-primary'
              : '',
            !expanded ? 'justify-center px-0' : ''
          ]"
          :title="expanded ? undefined : t('playlist.likedSongs')"
          @click="router.push('/liked')"
        >
          <SvgIcon name="play-like-fill" class-name="size-5 shrink-0" />
          <span v-if="expanded" class="truncate">{{ t('playlist.likedSongs') }}</span>
          <span
            v-if="expanded && isPlayingPlaylist(LIKED_PLAYLIST_ID)"
            class="ml-auto text-[10px] font-medium text-primary"
          >
            {{ t('sidebar.playing') }}
          </span>
        </button>
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
  <Teleport to="body">
    <div
      v-if="menuPlaylist"
      ref="menuRef"
      role="menu"
      class="fixed z-50 w-44 rounded-xl border border-border bg-bg-l p-1 text-text shadow-xl"
      :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
      @keydown="handleMenuKeydown"
    >
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover"
        @click="playPlaylist(menuPlaylist)"
      >
        <SvgIcon name="play-play" class-name="size-4" />
        {{ t('playlist.play') }}
      </button>
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover"
        @click="renamePlaylist(menuPlaylist)"
      >
        <SvgIcon name="common-edit" class-name="size-4" />
        {{ t('playlist.rename') }}
      </button>
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-hover"
        @click="confirmDeletePlaylist(menuPlaylist)"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('playlist.delete') }}
      </button>
    </div>
  </Teleport>
  <RenamePlaylistDialog v-model="renameDialogOpen" :playlist="renamePlaylistTarget" />
  <BaseDialog v-model="deleteDialogOpen" :title="t('playlist.delete')" width="max-w-sm">
    <p class="text-sm text-text-l">
      {{ t('playlist.confirmDelete', { name: deletePlaylistTarget?.name ?? '' }) }}
    </p>
    <template #footer>
      <button
        type="button"
        class="btn-hover rounded-lg px-3 py-1.5 text-sm"
        :disabled="deletingPlaylist"
        @click="deleteDialogOpen = false"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="btn-hover-base rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
        :disabled="deletingPlaylist"
        @click="deletePlaylist"
      >
        {{ t('playlist.delete') }}
      </button>
    </template>
  </BaseDialog>
</template>
