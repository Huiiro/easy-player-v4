<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { ref, computed } from 'vue'
import FloatingPanel from './FloatingPanel.vue'
import ObserveOpen from './ObserveOpen.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

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
  }>(),
  {
    items: () => [],
    align: 'end',
    side: 'auto',
    width: 'w-48',
    maxHeight: 300
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string | number): void
  (e: 'show'): void
  (e: 'hide'): void
}>()

const triggerRef = ref<HTMLElement | null>(null)
const maxHeightStyle = computed(() => {
  const value = props.maxHeight ?? '60vh'

  return {
    maxHeight: `min(${typeof value === 'number' ? `${value}px` : value}, var(--ep-floating-available-height, 60vh))`,
    overflowY: 'auto' as const
  }
})

const defaultIconClass = 'w-4 h-4 text-current'

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
        <slot name="trigger" />
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
          :class="width"
          :style="maxHeightStyle"
        >
          <template v-for="(item, i) in items" :key="i">
            <!-- group -->
            <div v-if="item.type === 'group'" class="py-1">
              <div v-if="item.label" class="px-3 py-1 text-xs text-text-l">
                {{ item.label }}
              </div>

              <template v-for="(child, j) in item.children" :key="j">
                <div v-if="child.type === 'divider'" class="my-1 h-px bg-border" />

                <MenuItem v-else v-slot="{ active }" :disabled="child.disabled">
                  <button
                    type="button"
                    :disabled="child.disabled"
                    :class="[
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition',
                      child.disabled && 'opacity-50 cursor-not-allowed',
                      isSelected(child)
                        ? 'bg-primary/30 font-medium text-primary'
                        : active
                          ? 'bg-primary/20'
                          : ''
                    ]"
                    @click="handleClick(child)"
                  >
                    <!--<component :is="child.icon" v-if="child.icon" class="w-4 h-4" />-->
                    <svgIcon v-if="child.icon" :name="child.icon" :class="iconClass(child)" />
                    {{ child.label }}
                  </button>
                </MenuItem>
              </template>
            </div>

            <!-- divider -->
            <div v-else-if="item.type === 'divider'" class="my-1 h-px bg-border" />

            <!-- item -->
            <MenuItem v-else v-slot="{ active }" :disabled="item.disabled">
              <button
                type="button"
                :disabled="item.disabled"
                :class="[
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition',
                  item.disabled && 'opacity-50 cursor-not-allowed',
                  isSelected(item)
                    ? 'bg-primary/30 font-medium text-primary'
                    : active
                      ? 'bg-primary/20'
                      : ''
                ]"
                @click="handleClick(item)"
              >
                <!--<component :is="item.icon" v-if="item.icon" class="w-4 h-4" />-->
                <svgIcon v-if="item.icon" :name="item.icon" :class="iconClass(item)" />
                {{ item.label }}
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
