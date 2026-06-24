<script setup lang="ts">
import ChatView from './components/ChatView.vue'
</script>

<template>
  <div class="app-shell">
    <!-- 导航栏 -->
    <header class="navbar">
      <div class="navbar-inner">
        <a href="/" class="logo">
          <span class="logo-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="url(#logo-grad)"/>
              <path d="M8 10l4 4-4 4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 19l6-9" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <defs>
                <linearGradient id="logo-grad" x1="0" y1="0" x2="28" y2="28">
                  <stop stop-color="#3b5cf6"/>
                  <stop offset="1" stop-color="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span class="logo-text">CodeAgentReview<span class="logo-text-cn"> 多智能体代码审查平台</span></span>
        </a>
        <nav class="nav-links">
          <a href="#" class="nav-link active">审查</a>
          <a href="#" class="nav-link">历史</a>
          <a href="#" class="nav-link">设置</a>
        </nav>
      </div>
    </header>

    <!-- 主内容 -->
    <main class="main-content">
      <ChatView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59, 92, 246, 0.06), transparent),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(139, 92, 246, 0.04), transparent),
    var(--color-bg);
}

/* ── 导航栏 ── */
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 12px 24px;
}

.navbar-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-xl);
  padding: 10px 20px;
  box-shadow: var(--shadow-md);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.logo-icon svg {
  display: block;
}

.logo-text {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: -0.3px;
}

.logo-text-cn {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  letter-spacing: 0;
}

.nav-links {
  display: flex;
  gap: 4px;
}

.nav-link {
  text-decoration: none;
  padding: 7px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.nav-link:hover {
  color: var(--color-text);
  background: rgba(0, 0, 0, 0.04);
}

.nav-link.active {
  color: var(--color-primary);
  background: var(--color-primary-light);
}

/* ── 主内容 ── */
.main-content {
  flex: 1;
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 80px;
}
</style>
