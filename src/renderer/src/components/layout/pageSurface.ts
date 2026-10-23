import { defineComponent, h, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue'

function surface(name: string): ReturnType<typeof defineComponent> {
  return defineComponent({
    name,
    setup(_, { slots }) {
      const element = ref<HTMLElement | null>(null)
      let scrollTop = 0
      onActivated(() => {
        void nextTick(() => {
          if (element.value) element.value.scrollTop = scrollTop
        })
      })
      onDeactivated(() => {
        scrollTop = element.value?.scrollTop ?? 0
      })
      onBeforeUnmount(() => {
        scrollTop = 0
      })
      return () =>
        h(
          'div',
          {
            ref: element,
            class: 'ep-page custom-scrollbar',
            onScroll: () => {
              scrollTop = element.value?.scrollTop ?? 0
            }
          },
          slots.default?.()
        )
    }
  })
}
export const CachedPageSurface = surface('CachedPageSurface')
export const PageSurface = surface('PageSurface')
