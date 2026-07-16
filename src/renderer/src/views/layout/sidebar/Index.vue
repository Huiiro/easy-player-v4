<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'

interface NavigationItem {
  labelKey: string
  path: string
  icon: string
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const expanded = ref(true)
const playlistsExpanded = ref(true)

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
  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-[var(--color-text-l)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]'

function isActive(path: string): boolean {
  return activePath.value === path || activePath.value.startsWith(`${path}/`)
}

function navigate(item: NavigationItem): void {
  if (route.path !== item.path) void router.push(item.path)
}

function createPlaylist(): void {
  // todo
}
</script>

<template>
  <aside
    class="flex h-full flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-[width] duration-200"
    :class="expanded ? 'w-54' : 'w-14'"
  >
    <nav
      class="custom-scrollbar flex-1 overflow-y-auto px-2 py-2"
      :aria-label="t('sidebar.ariaLabel')"
    >
      <section class="pb-3">
        <div
          class="mb-1 flex h-8 items-center px-2"
          :class="expanded ? 'justify-between' : 'justify-center'"
        >
          <p
            v-if="expanded"
            class="text-[11px] font-semibold tracking-[0.08em] text-[var(--color-text-l)]"
          >
            {{ t('sidebar.library') }}
          </p>
          <button
            class="grid size-7 place-items-center rounded-md text-[var(--color-text-l)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
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
              ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] font-semibold text-[var(--color-primary)]'
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

      <section class="border-t border-[var(--color-border)] py-3">
        <div v-if="expanded" class="mb-1 flex items-center justify-between px-2">
          <p class="text-[11px] font-semibold tracking-[0.08em] text-[var(--color-text-l)]">
            {{ t('sidebar.playlists') }}
          </p>
          <div class="flex items-center gap-1">
            <button
              class="grid size-6 place-items-center rounded-md text-[var(--color-text-l)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
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
              class="grid size-6 place-items-center rounded-md text-[var(--color-text-l)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
              :title="t('sidebar.createPlaylist')"
              @click="createPlaylist"
            >
              <SvgIcon name="common-plus" class-name="size-4" />
            </button>
          </div>
        </div>
        <button
          v-else
          :class="[navItemClass, 'justify-center px-0']"
          :title="t('sidebar.createPlaylist')"
          @click="createPlaylist"
        >
          <SvgIcon name="common-plus" class-name="size-5 shrink-0" />
        </button>
        <p
          v-if="expanded && playlistsExpanded"
          class="px-2 pt-1 text-xs leading-5 text-[var(--color-text-l)]"
        >
          {{ t('sidebar.playlistEmpty') }}
        </p>
      </section>

      <section class="border-t border-[var(--color-border)] pt-3">
        <p
          v-if="expanded"
          class="mb-1 px-2 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-text-l)]"
        >
          {{ t('sidebar.more') }}
        </p>
        <button
          v-for="item in utilityItems"
          :key="item.path"
          :class="[
            navItemClass,
            isActive(item.path)
              ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_15%,transparent)] font-semibold text-[var(--color-primary)]'
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
    </nav>
  </aside>
</template>
