# 项目约定

## 必读
- 契约以 SPEC.md 为准，冲突时先改 SPEC

## 技术约定
- Vue3 <script setup lang="ts">，不用 Options API
- 状态一律走 Pinia store，组件内不用 ref 存跨组件状态
- store action 命名：动词开头（createXxx / applyXxx / flushXxx）
- 类型定义全部放 src/types/，不在组件内定义跨组件类型

## 不要做的事
- 不要在组件里直接 fetch，走 composables
- 不要绕过 useRunStore.applyEvent 改 run 状态
- 不要用 EventSource，用 fetch + ReadableStream

## 常用指令
- pnpm dev / pnpm dev:server
- 测试：暂无