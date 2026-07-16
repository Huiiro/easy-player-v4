import { computed, watch } from 'vue'

interface UseDialogModelOptions {
  onOpen?: () => void | Promise<void>
  onClose?: () => void
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useDialogModel(
  props: { modelValue: boolean },
  emit: (e: 'update:modelValue', v: boolean) => void,
  options: UseDialogModelOptions = {}
) {
  const visible = computed({
    get: () => props.modelValue,
    set: (val: boolean) => emit('update:modelValue', val)
  })

  watch(
    () => props.modelValue,
    async (val) => {
      if (val) {
        await options.onOpen?.()
      } else {
        options.onClose?.()
      }
    }
  )

  return {
    visible
  }
}
