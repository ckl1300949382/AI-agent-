import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { useSessionStore } from '@/stores/session'
import { useRunStore } from '@/stores/run'
import { useMessageStore } from '@/stores/message'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus)

// 启动：从 IndexedDB 加载会话列表
const sessionStore = useSessionStore(pinia)
sessionStore.loadAll()

// 页面关闭前：强制 flush 所有数据到 IndexedDB
window.addEventListener('beforeunload', () => {
  const runStore = useRunStore(pinia)
  const messageStore = useMessageStore(pinia)
  // 不 await（beforeunload 不等待异步），IndexedDB 写操作会尽量完成
  runStore.flushToIDB()
  messageStore.flushToIDB()
})

app.mount('#app')
