import 'vue-router'
import type { PageTransition } from '@/components/ui/types'
declare module 'vue-router' {
  interface RouteMeta {
    keepAlive?: boolean
    transition?: PageTransition
  }
}
