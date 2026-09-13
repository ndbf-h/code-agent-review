import { describe, it, expect } from 'vitest'
import { parseRoleModels } from '../role-router'

describe('parseRoleModels ROLE_MODELS 解析', () => {
  it('未配置返回空对象', () => {
    expect(parseRoleModels(undefined)).toEqual({})
    expect(parseRoleModels('')).toEqual({})
  })

  it('role=model 简单形式', () => {
    const routes = parseRoleModels('security=deepseek-reasoner, style=deepseek-chat')
    expect(routes.security).toEqual({ model: 'deepseek-reasoner' })
    expect(routes.style).toEqual({ model: 'deepseek-chat' })
  })

  it('alias:model 跨 provider：env 齐全时展开 baseUrl/key', () => {
    const env = {
      LLM_ROUTE_SF_BASE_URL: 'https://api.siliconflow.cn/v1/',
      LLM_ROUTE_SF_API_KEY: 'sk-test'
    }
    const routes = parseRoleModels('security=sf:deepseek-ai/DeepSeek-V3', env)
    expect(routes.security).toEqual({
      model: 'deepseek-ai/DeepSeek-V3',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-test'
    })
  })

  it('alias 缺少 env 配置时退化为仅换模型名', () => {
    const routes = parseRoleModels('security=sf:some-model', {})
    expect(routes.security).toEqual({ model: 'sf:some-model' })
  })

  it('非法条目被跳过，不影响其余解析', () => {
    const routes = parseRoleModels('bad-entry, logic=deepseek-chat')
    expect(routes.badentry ?? routes['bad-entry']).toBeUndefined()
    expect(routes.logic).toEqual({ model: 'deepseek-chat' })
  })
})
