import type { App } from 'vue'

import BaseButton from './BaseButton.vue'
import BaseInput from './BaseInput.vue'
import BaseMenu from './BaseMenu.vue'
import BaseDialog from './BaseDialog.vue'
import BaseSlider from './BaseSlider.vue'
import BaseDrawer from './BaseDrawer.vue'
import BaseSwitch from './BaseSwitch.vue'
import BaseMessage from './BaseMessage.vue'
import BaseSelect from './BaseSelect.vue'
import BaseColorPicker from './BaseColorPicker.vue'
import BaseSkeleton from './BaseSkeleton.vue'
import BasePopover from './BasePopover.vue'
import BaseRange from './BaseRange.vue'
import BaseConfirmDialog from './BaseConfirmDialog.vue'

// 统一管理
const components = [
  BaseButton,
  BaseInput,
  BaseMenu,
  BaseDialog,
  BaseSlider,
  BaseDrawer,
  BaseSwitch,
  BaseMessage,
  BaseSelect,
  BaseColorPicker,
  BaseSkeleton,
  BasePopover,
  BaseRange,
  BaseConfirmDialog
]

/**
 * 插件注册
 */
export default {
  install(app: App) {
    components.forEach((component) => {
      if (!component.name) {
        console.warn('Component is missing name:', component)
        return
      }
      app.component(component.name, component)
    })
  }
}

export {
  BaseButton,
  BaseInput,
  BaseMenu,
  BaseDialog,
  BaseSlider,
  BaseDrawer,
  BaseSwitch,
  BaseMessage,
  BaseSelect,
  BaseColorPicker,
  BaseSkeleton
}
export { default as BasePopover } from './BasePopover.vue'
export { default as BaseRange } from './BaseRange.vue'
export { default as BaseConfirmDialog } from './BaseConfirmDialog.vue'
export { useMessage } from './useMessage'
export type { ControlSize, FloatingSide, FloatingAlign, PageTransition } from './types'
