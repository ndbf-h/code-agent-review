import type { AgentRole } from '../../../../shared/types'
import { systemPrompt as orchestrator } from './orchestrator'
import { systemPrompt as security } from './security-reviewer'
import { systemPrompt as performance } from './performance-reviewer'
import { systemPrompt as style } from './style-reviewer'
import { systemPrompt as logic } from './logic-reviewer'

const rolePrompts: Record<AgentRole, string> = {
  orchestrator,
  security,
  performance,
  style,
  logic
}

function getRolePrompt(role: AgentRole): string {
  return rolePrompts[role]
}

export { getRolePrompt }
