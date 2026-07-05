// server/src/tools/rules/index.ts
import { securityRules } from './security'
import { performanceRules } from './performance'
import { styleRules } from './style'
import { logicRules } from './logic'
import type { Rule } from './types'

export { securityRules, performanceRules, styleRules, logicRules }
export type { Rule, RuleMatch, RuleSeverity } from './types'
export { scanCode } from './types'

/** 按审查维度获取规则 */
export function getRulesByDimension(dimension: string): Rule[] {
  const map: Record<string, Rule[]> = {
    security: securityRules,
    performance: performanceRules,
    style: styleRules,
    logic: logicRules
  }
  return map[dimension] || []
}

/** 获取所有规则 */
export function getAllRules(): Rule[] {
  return [...securityRules, ...performanceRules, ...styleRules, ...logicRules]
}
