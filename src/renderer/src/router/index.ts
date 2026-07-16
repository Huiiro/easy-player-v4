import { createRouter, createWebHashHistory } from 'vue-router'
import { constRoutes } from './routes.ts'

const router = createRouter({
  history: createWebHashHistory('/'),
  routes: [...constRoutes]
})

router.beforeEach(async () => {
  return
})

export default router
