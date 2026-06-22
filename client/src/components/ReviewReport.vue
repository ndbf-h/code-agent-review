<script setup lang="ts">
import type { ReviewReport as ReviewReportType } from '../types/index'

defineProps<{
  report: ReviewReportType
}>()

function getSeverityLabel(severity: string): string {
  if (severity === 'critical') return 'Critical'
  if (severity === 'warning') return 'Warning'
  return 'Suggestion'
}

function getSeverityClass(severity: string): string {
  if (severity === 'critical') return 'sev-critical'
  if (severity === 'warning') return 'sev-warning'
  return 'sev-suggestion'
}

function getTagType(severity: string): string {
  if (severity === 'critical') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}
</script>

<template>
  <div class="review-report">
    <div class="report-header">
      <span class="report-title">Review Report</span>
      <span class="report-score">Overall Score: {{ report.score }} / 100</span>
    </div>

    <div
      class="report-section"
      v-for="(label, sevKey) in ({ critical: 'Critical', warning: 'Warning', suggestion: 'Suggestion' } as Record<string, string>)"
      :key="sevKey"
    >
      <template v-if="report.issues.filter(i => i.severity === sevKey).length > 0">
        <div class="section-title" :class="getSeverityClass(sevKey)">-- {{ label }} --</div>
        <div
          v-for="(issue, idx) in report.issues.filter(i => i.severity === sevKey)"
          :key="idx"
          class="issue-card"
        >
          <div class="issue-header">
            <span class="issue-loc">Line {{ issue.line }}</span>
            <span class="issue-category">{{ issue.category }}</span>
            <el-tag :type="getTagType(sevKey)" size="small">
              {{ getSeverityLabel(sevKey) }}
            </el-tag>
          </div>
          <p class="issue-message">{{ issue.message }}</p>
          <p class="issue-suggestion">{{ issue.suggestion }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.review-report {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 20px;
}

.report-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
}

.report-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.report-score {
  font-size: 14px;
  font-weight: 500;
  color: #409eff;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 16px 0 8px;
}

.sev-critical { color: #f56c6c; }
.sev-warning { color: #e6a23c; }
.sev-suggestion { color: #909399; }

.issue-card {
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 8px;
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.issue-loc {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #909399;
}

.issue-category {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  flex: 1;
}

.issue-message {
  font-size: 14px;
  color: #606266;
  margin-bottom: 4px;
}

.issue-suggestion {
  font-size: 13px;
  color: #67c23a;
  font-style: italic;
}
</style>
