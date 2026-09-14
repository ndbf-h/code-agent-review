// ESLint flat config：server（Node/TS）、client（Vue3/TS）、shared 三套规则统一在根目录维护。
// 运行：npm run lint / npm run lint:fix
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

const tsRules = {
  // 项目里 LLM 响应、JSON 解析等场景仍有少量 any，先降为 warn 逐步收敛，不阻断 CI
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
  ]
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'evals/**',
      '**/*.d.ts',
      'client/public/**',
      '**/coverage/**'
    ]
  },

  // ── server + shared：Node 环境 TypeScript ──
  {
    files: ['server/src/**/*.ts', 'shared/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      ...tsRules,
      // 运行时日志统一走 logger（REQ-05），禁止裸 console；CLI（eval）与测试文件单独放行
      'no-console': 'error'
    }
  },
  {
    // eval 是命令行工具，直接向终端输出是其正常行为
    files: ['server/src/eval/**/*.ts'],
    rules: { 'no-console': 'off' }
  },

  // ── client：浏览器环境 TypeScript + Vue SFC ──
  {
    files: ['client/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: tsRules
  },
  {
    files: ['client/src/**/*.vue'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...pluginVue.configs['flat/recommended']
    ],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module'
      },
      globals: { ...globals.browser }
    },
    rules: {
      ...tsRules,
      // 现有组件大量使用 <el-*> 与单词组件名（如 ChatView 内部子组件），命名约束由 code review 把关
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    // 前端调试输出较少，保留为 warn 便于后续清理
    files: ['client/src/**/*.{ts,vue}'],
    rules: { 'no-console': 'warn' }
  },

  // ── 测试文件：vitest 全局与 Node 全局 ──
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // 关闭与 Prettier 冲突的格式类规则（必须放在最后）
  prettierConfig
)
