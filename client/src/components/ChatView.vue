<script setup lang="ts">
import { useReviewStore } from '../stores/review'
import { useChat } from '../composables/useChat'
import CodeInput from './CodeInput.vue'
import ChatMessage from './ChatMessage.vue'
import ReviewReport from './ReviewReport.vue'

const store = useReviewStore()
const { startReview } = useChat()
</script>

<template>
  <div class="chat-view">
    <div class="message-list" v-if="store.messages.length > 0 || store.loading">
      <template v-for="msg in store.messages" :key="msg.id">
        <ChatMessage :message="msg" />
        <ReviewReport v-if="msg.type === 'report' && msg.report" :report="msg.report" />
      </template>

      <div v-if="store.loading" class="loading-indicator">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
    </div>

    <div class="input-area" :class="{ 'input-compact': store.messages.length > 0 }">
      <CodeInput :disabled="store.loading" @submit="startReview" />
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.loading-indicator {
  display: flex;
  gap: 6px;
  padding: 8px 0;
}

.loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #409eff;
  animation: pulse 1.4s ease-in-out infinite;
}

.loading-dot:nth-child(2) { animation-delay: 0.2s; }
.loading-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.input-area {
  padding-top: 40px;
}

.input-compact {
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}
</style>
