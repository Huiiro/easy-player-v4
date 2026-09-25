import './styles/index.css'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './stores'
import i18n from './i18n'
import 'virtual:svg-icons-register'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import VueVirtualScroller from 'vue-virtual-scroller'
import { useLogStore } from '@/stores/log/logStore'
import { installRendererLogging } from '@/services/logger'

const app = createApp(App)
installRendererLogging()
app.use(router)
app.use(store)
useLogStore().subscribe()
app.use(i18n)
app.use(VueVirtualScroller)
app.component('SvgIcon', SvgIcon)
app.mount('#app')
