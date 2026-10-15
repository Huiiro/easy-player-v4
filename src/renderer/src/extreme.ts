import { createApp } from 'vue'
import ExtremeRoot from './ExtremeRoot.vue'
import store from './stores'
import i18n from './i18n'
createApp(ExtremeRoot).use(store).use(i18n).mount('#app')
