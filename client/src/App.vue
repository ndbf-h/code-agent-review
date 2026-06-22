<script setup lang="ts">
import ChatView from './components/ChatView.vue'
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>CodeAgentReview</h1>
      <span class="app-subtitle">Multi-Agent Code Review</span>
    </header>
    <main class="app-main">
      <ChatView />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  padding: 20px 24px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.app-header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.app-subtitle {
  font-size: 13px;
  color: #909399;
}

.app-main {
  flex: 1;
  padding: 24px;
}
</style>
