import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'console',
      component: () => import('@/views/Console.vue'),
    },
  ],
})

export default router
