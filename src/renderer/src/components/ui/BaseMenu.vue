<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { ref, computed } from 'vue'
import FloatingPanel from './FloatingPanel.vue'
import ObserveOpen from './ObserveOpen.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { controlSizeClasses, type ControlSize } from './types'

defineOptions({
  name: 'BaseMenu'
})

type MenuItemType = {
  label?: string
  value?: string | number
  icon?: string // use svg icon
  iconClass?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'item' | 'divider'
}

type MenuGroup = {
  type: 'group'
  label?: string
  children: MenuItemType[]
}

type MenuData = MenuItemType | MenuGroup
type Side = 'top' | 'bottom' | 'left' | 'right' | 'auto'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    items?: MenuData[]
    align?: 'start' | 'end'
    side?: Side
    width?: string
    teleport?: boolean
    maxHeight?: number | string
    size?: ControlSize
    appearance?: 'default' | 'glass'
  }>(),
  {
    items: () => [],
    align: 'end',
    side: 'auto',
    width: 'w-48',
    maxHeight: 300,
    size: 'md',
    appearance: 'default'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string | number): void
  (e: 'show'): void
  (e: 'hide'): void
}>()

const triggerRef = ref<HTMLElement | null>(null)
const sizeClass = computed(() => controlSizeClasses[props.size])
const maxHeightStyle = computed(() => {
  const value = props.maxHeight ?? '60vh'

  return {
    maxHeight: `min(${typeof value === 'number' ? `${value}px` : value}, var(--ep-floating-available-height, 60vh))`,
    overflowY: 'auto' as const
  }
})

const defaultIconClass = 'size-[1em] shrink-0 text-current'

function iconClass(item: MenuItemType): string[] {
  return [defaultIconClass, item.iconClass ?? '']
}

function isSelected(item: MenuItemType): boolean {
  return item.value !== undefined && item.value === props.modelValue
}

function handleClick(item: MenuItemType): void {
  if (item.disabled) return
  if (item.value !== undefined) {
    emit('update:modelValue', item.value)
  }
  item.onClick?.()
}
</script>

<template>
  <Menu v-slot="{ open }" as="div" class="relative inline-block text-text">
    <ObserveOpen :open="open" @change="$event ? emit('show') : emit('hide')" />

    <!-- trigger -->
    <div ref="triggerRef" class="">
      <MenuButton as="div">
        <slot name="trigger" :size="size" />
      </MenuButton>
    </div>

    <!-- dropdown -->
    <FloatingPanel
      :open="open"
      :anchor="triggerRef"
      :teleport="teleport"
      :side="side === 'auto' ? 'bottom' : side"
      :align="align"
    >
      <transition
        enter-active-class="transition duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-enter)]"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <MenuItems
          class="ep-menu rounded-xl border shadow-lg p-1 no-scrollbar"
          :class="[width, `ep-control--${size}`, { 'ep-menu--glass': appearance === 'glass' }]"
          :style="maxHeightStyle"
        >
          <template v-for="(item, i) in items" :key="i">
            <!-- group -->
            <div v-if="item.type === 'group'" class="flow-root">
              <div v-if="item.label" class="py-1 text-text-l" :class="sizeClass">
                {{ item.label }}
              </div>

              <template v-for="(child, j) in item.children" :key="j">
                <div v-if="child.type === 'divider'" class="mx-2 my-1.5 h-px bg-border" />

                <MenuItem v-else v-slot="{ active }" :disabled="child.disabled">
                  <button
                    type="button"
                    :disabled="child.disabled"
                    :data-active="active"
                    :data-selected="isSelected(child)"
                    :class="[
                      'ep-menu-item w-full flex min-w-0 items-center gap-2 rounded-lg transition',
                      sizeClass,
                      child.disabled && 'opacity-50 cursor-not-allowed',
                      isSelected(child)
                        ? 'bg-primary/8 font-medium text-primary'
                        : active
                          ? 'bg-primary/4'
                          : ''
                    ]"
                    @click="handleClick(child)"
                  >
                    <SvgIcon v-if="child.icon" :name="child.icon" :class="iconClass(child)" />
                    <span class="min-w-0 flex-1 text-left">{{ child.label }}</span>
                  </button>
                </MenuItem>
              </template>
            </div>

            <!-- divider -->
            <div v-else-if="item.type === 'divider'" class="mx-2 my-1.5 h-px bg-border" />

            <!-- item -->
            <MenuItem v-else v-slot="{ active }" :disabled="item.disabled">
              <button
                type="button"
                :disabled="item.disabled"
                :data-active="active"
                :data-selected="isSelected(item)"
                :class="[
                  'ep-menu-item w-full flex min-w-0 items-center gap-2 rounded-lg transition',
                  sizeClass,
                  item.disabled && 'opacity-50 cursor-not-allowed',
                  isSelected(item)
                    ? 'bg-primary/8 font-medium text-primary'
                    : active
                      ? 'bg-primary/4'
                      : ''
                ]"
                @click="handleClick(item)"
              >
                <SvgIcon v-if="item.icon" :name="item.icon" :class="iconClass(item)" />
                <span class="min-w-0 flex-1 text-left">{{ item.label }}</span>
              </button>
            </MenuItem>
          </template>

          <!-- slot fallback -->
          <slot v-if="!items.length" />
        </MenuItems>
      </transition>
    </FloatingPanel>
  </Menu>
</template>

<style scoped>
.ep-menu--glass {
  border-color: rgb(255 255 255 / 12%);
  border-radius: 0.5rem;
  background: rgb(9 12 17 / 90%);
  color: rgb(255 255 255 / 72%);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
}
.ep-menu--glass .ep-menu-item[data-active='true'] {
  background: rgb(255 255 255 / 9%);
  color: white;
}
.ep-menu--glass .ep-menu-item[data-selected='true'] {
  background: color-mix(in srgb, var(--color-primary) 38%, transparent);
  color: white;
}
</style>
