<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const THEME_KEY = 'codeagent-theme'
const isDark = ref(false)

function toggleTheme() {
  const dark = !isDark.value
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
}

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
})

const navItems = [
  { to: '/', label: '审查', name: 'home', icon: 'review' },
  { to: '/history', label: '历史', name: 'history', icon: 'history' }
]
</script>

<template>
  <div class="app-shell">
    <!-- 左侧导航栏：全站工作台布局的锚点 -->
    <aside class="sidebar">
      <router-link to="/" class="logo">
        <span class="logo-icon">
          <svg width="30" height="30" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="url(#logo-grad)" />
            <path
              d="M8 10l4 4-4 4"
              stroke="#fff"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M14 19l6-9"
              stroke="#fff"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="28" y2="28">
                <stop stop-color="#3b5cf6" />
                <stop offset="1" stop-color="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <span class="logo-text">
          CodeAgentReview
          <span class="logo-text-cn">多 Agent 代码审查</span>
        </span>
      </router-link>

      <nav class="side-nav" aria-label="主导航">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="side-link"
          :class="{ active: route.name === item.name }"
        >
          <span class="side-icon" aria-hidden="true">
            <svg
              v-if="item.icon === 'review'"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" />
              <path d="M9.2 12.2l2 2 3.6-4.2" />
            </svg>
            <svg
              v-else
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <span class="side-label">{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="side-footer">
        <button
          type="button"
          class="theme-toggle"
          :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
          :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleTheme"
        >
          <svg
            v-if="isDark"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            />
          </svg>
          <svg
            v-else
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <span class="side-label">{{ isDark ? '浅色模式' : '深色模式' }}</span>
        </button>
      </div>
    </aside>

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, var(--color-bg-glow-primary), transparent),
    radial-gradient(ellipse 60% 40% at 80% 100%, var(--color-bg-glow-accent), transparent),
    var(--color-bg);
}

.sidebar {
  width: 216px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  border-right: 1px solid var(--color-border-light);
  background: var(--color-nav-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  padding: 4px 8px 20px;
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 16px;
}

.logo-icon svg {
  display: block;
  flex-shrink: 0;
}

.logo-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.25;
}

.logo-text-cn {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.side-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.side-icon {
  display: inline-flex;
  flex-shrink: 0;
}

.side-link:hover {
  color: var(--color-text);
  background: var(--color-hover-bg);
}

.side-link.active {
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.side-footer {
  border-top: 1px solid var(--color-border-light);
  padding-top: 12px;
}

.theme-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.theme-toggle:hover {
  color: var(--color-primary);
  background: var(--color-primary-light);
}

/* 主内容区不再限宽：各视图自行管理布局（工作台需要全宽三栏） */
.main-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px 40px;
}

@media (max-width: 900px) {
  .app-shell {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    flex-direction: row;
    align-items: center;
    padding: 10px 14px;
    border-right: none;
    border-bottom: 1px solid var(--color-border-light);
  }

  .logo {
    padding: 0;
    border-bottom: none;
    margin-bottom: 0;
    margin-right: auto;
  }

  .logo-text-cn {
    display: none;
  }

  .side-nav {
    flex-direction: row;
    flex: 0 0 auto;
  }

  .side-link {
    padding: 7px 12px;
  }

  .side-footer {
    border-top: none;
    padding-top: 0;
    margin-left: 8px;
  }

  .theme-toggle .side-label {
    display: none;
  }

  .theme-toggle {
    width: auto;
  }

  .main-content {
    padding: 16px 14px 40px;
  }
}
</style>
