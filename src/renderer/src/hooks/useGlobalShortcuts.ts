// import { watch, onMounted, onBeforeUnmount } from 'vue'
// import { ElMessage } from 'element-plus'
// import { useI18n } from 'vue-i18n'
// import { useUIStore } from '@/store/ui'
//
// export function useGlobalShortcuts(): void {
//   const uiStore = useUIStore()
//   const { t } = useI18n()
//   const registerShortcuts = async (): Promise<void> => {
//     if (!globalShortcutApi) return
//
//     const plainShortcuts = JSON.parse(JSON.stringify(uiStore.globalShortcutKeys))
//
//     const enabled = !!uiStore.enableGlobalShortcutKeys
//
//     try {
//       const failed = await globalShortcutApi.register(enabled, plainShortcuts)
//       if (failed && failed.length > 0) {
//         ElMessage.warning(`${t('failed_to_register_shortcut')} ${failed.join(', ')}`)
//         for (const key of failed) {
//           const action = Object.entries(uiStore.globalShortcutKeys).find(
//             ([, v]) => v.toLowerCase() === key.toLowerCase()
//           )?.[0]
//           if (action) {
//             uiStore.globalShortcutKeys[action] = ''
//           }
//         }
//       }
//     } catch (err) {
//       console.error('register global shortcuts failed:', err)
//       ElMessage.error(t('global_shortcut_registration_failed'))
//     }
//   }
//
//   const unregisterShortcuts = (): void => {
//     globalShortcutApi?.unregister()
//   }
//
//   watch(() => [uiStore.enableGlobalShortcutKeys, uiStore.globalShortcutKeys], registerShortcuts, {
//     deep: true
//   })
//
//   onMounted(async () => {
//     await registerShortcuts()
//   })
//   onBeforeUnmount(() => {
//     unregisterShortcuts()
//   })
// }
