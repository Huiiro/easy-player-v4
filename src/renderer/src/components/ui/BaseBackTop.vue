<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
  type CSSProperties
} from 'vue'
import { useI18n } from 'vue-i18n'
import { cssSize, type BackTopTarget, type BackTopBehavior } from './types'

defineOptions({ name: 'BaseBackTop', inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    target?: BackTopTarget
    visibilityHeight?: number
    visible?: boolean
    disabled?: boolean
    behavior?: BackTopBehavior
    reducedMotion?: boolean
    position?: 'fixed' | 'absolute'
    teleport?: boolean
    bottom?: string | number
    right?: string | number
    size?: string | number
    ariaLabel?: string
    /** Virtual lists can supply their own API instead of native scrollTo. */
    scrollToTop?: (behavior: BackTopBehavior) => void
  }>(),
  {
    visibilityHeight: 320,
    visible: undefined,
    disabled: false,
    behavior: 'smooth',
    reducedMotion: false,
    position: 'fixed',
    teleport: true
  }
)
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const { t } = useI18n()
const active = ref(true)
const scrollTop = ref(0)
const target = computed(() => {
  if (props.target === undefined) return window
  const value = typeof props.target === 'function' ? props.target() : props.target
  return value && value === document.scrollingElement ? window : (value ?? null)
})
const shown = computed(
  () => active.value && (props.visible ?? scrollTop.value > Math.max(0, props.visibilityHeight))
)
const label = computed(() => props.ariaLabel ?? t('ui.backToTop'))
const buttonStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = { position: props.position }
  if (props.bottom !== undefined) style.bottom = cssSize(props.bottom)
  if (props.right !== undefined) style.right = cssSize(props.right)
  if (props.size !== undefined) style.width = style.height = cssSize(props.size)
  return style
})
let frame = 0
watch(
  () => [target.value, active.value, props.visibilityHeight] as const,
  ([element, enabled], _old, cleanup) => {
    const read = (): void => {
      scrollTop.value = element ? ('scrollY' in element ? element.scrollY : element.scrollTop) : 0
    }
    const schedule = (): void => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          read()
        })
    }
    if (enabled) read()
    if (!element || !enabled) return
    element.addEventListener('scroll', schedule, { passive: true })
    cleanup(() => {
      element.removeEventListener('scroll', schedule)
      cancelAnimationFrame(frame)
      frame = 0
    })
  },
  { immediate: true, flush: 'post' }
)
function backToTop(event: MouseEvent): void {
  if (props.disabled) return
  emit('click', event)
  if (event.defaultPrevented) return
  const reduce =
    props.reducedMotion ||
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior = reduce ? 'auto' : props.behavior
  if (props.scrollToTop) props.scrollToTop(behavior)
  else target.value?.scrollTo({ top: 0, behavior })
}
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <Teleport to="body" :disabled="position === 'absolute' || !teleport">
    <Transition name="ep-backtop">
      <button
        v-if="shown"
        v-bind="$attrs"
        type="button"
        class="ep-backtop ep-focusable"
        :style="buttonStyle"
        :disabled="disabled"
        :aria-label="label"
        :title="label"
        :data-reduced-motion="reducedMotion || undefined"
        @click="backToTop"
      >
        <slot
          ><svg
            class="ep-backtop-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5m-6 6 6-6 6 6" /></svg
        ></slot>
      </button>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ep-backtop {
  box-sizing: border-box;
  right: var(--ep-backtop-right, 20px);
  bottom: var(--ep-backtop-bottom, 20px);
  width: var(--ep-backtop-size, 36px);
  height: var(--ep-backtop-size, 36px);
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--ep-backtop-radius, 999px);
  color: var(--color-text);
  background: var(--color-bg-l);
  box-shadow: var(--ep-surface-shadow, 0 8px 24px rgb(0 0 0 / 12%));
  isolation: isolate;
  cursor: pointer;
  transition:
    opacity var(--motion-duration-fast, 140ms),
    transform var(--motion-duration-fast, 140ms),
    bottom var(--motion-duration-slow, 300ms) var(--motion-ease-spring, ease),
    right var(--motion-duration-slow, 300ms);
}
.ep-backtop::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--color-hover-bg);
  opacity: 0;
  transition: opacity var(--motion-duration-fast, 140ms);
}
.ep-backtop:hover::before {
  opacity: 1;
}
.ep-backtop:disabled {
  opacity: var(--ep-disabled-opacity, 0.5);
  cursor: not-allowed;
}
.ep-backtop:disabled::before {
  opacity: 0;
}
.ep-backtop-icon {
  pointer-events: none;
}
.ep-backtop-leave-active {
  pointer-events: none;
}
.ep-backtop-enter-from,
.ep-backtop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
.ep-backtop[data-reduced-motion='true'] {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .ep-backtop {
    transition: none;
  }
}
</style>
