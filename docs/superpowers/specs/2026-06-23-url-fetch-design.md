# URL 代码抓取功能 — 设计方案

> 日期：2026-06-23
> 状态：已确认，待实施

---

## 一、功能概述

用户输入一个 URL（如 GitHub 文件、Gist、Pastebin），系统自动抓取该 URL 的代码内容，填入代码输入框供用户预览、编辑后发起审查。

---

## 二、UI 交互

在 `CodeInput.vue` 的语言选择器下方，新增 URL 输入栏：

```
Language: [TypeScript ▾]     URL: [https://github.com/...] [抓取按钮]
```

### 交互流程

1. 用户输入 URL，点击「抓取」
2. 前端调用 `POST /api/fetch-url`，后端抓取 URL 内容
3. 成功 → 代码填入 TextArea，上方提示：`✅ 已抓取 234 行 TypeScript 代码，可编辑后提交审查`
4. 失败 → 红色提示：`❌ 无法访问该链接（可能需登录或已失效），请手动粘贴代码到下方`
5. 代码过长（>500行）→ 黄色提示：`⚠️ 代码较长（xx 行），完整代码已加载，可滚动查看`

### 长代码处理

- TextArea 设置 `max-height: 400px` + 内部滚动
- 抓取成功后显示代码行数标签

---

## 三、后端接口

### `POST /api/fetch-url`

**请求体：**
```json
{ "url": "https://raw.githubusercontent.com/user/repo/main/src/app.ts" }
```

**成功响应：**
```json
{
  "content": "// full source code...",
  "byteSize": 12345,
  "lineCount": 234
}
```

**失败响应：**
```json
{ "error": "无法访问该链接（连接超时）" }
```

### 安全与限制

| 项目 | 限制 |
|------|------|
| 协议 | 仅 http / https |
| 超时 | 10 秒 |
| 最大内容 | 1 MB |
| 重定向 | 最多跟随 3 次 |
| User-Agent | 标准浏览器 UA，避免被反爬 |

### 错误处理

| 场景 | 返回错误信息 |
|------|-------------|
| URL 格式无效 | "URL 格式不正确" |
| 协议非 http/https | "仅支持 http/https 链接" |
| 连接超时 | "请求超时，请检查链接是否可访问" |
| HTTP 4xx | "目标服务器拒绝访问（404/403）" |
| HTTP 5xx | "目标服务器异常" |
| 内容超 1MB | "文件过大（超过 1MB），请手动粘贴" |
| 网络错误 | "网络请求失败，请检查链接" |

---

## 四、涉及文件

| 文件 | 改动 |
|------|------|
| `server/src/routes/tasks.ts` | 新增 `POST /api/fetch-url` 路由 |
| `client/src/components/CodeInput.vue` | 新增 URL 输入栏 + 抓取逻辑 + 状态提示 |

---

## 五、验收标准

- [ ] 输入有效 GitHub Raw URL，代码正确填入输入框
- [ ] 输入无效 URL，显示错误提示，代码框不受影响
- [ ] 超长代码正常显示，不撑爆页面
- [ ] 抓取后仍可手动编辑代码再提交审查
- [ ] 仅支持 http/https，其他协议拒绝
