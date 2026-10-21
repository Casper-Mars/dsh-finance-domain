import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/plugin'
import { DEFAULT_FINANCE_DOMAIN_CONFIG, resolveConfig } from '../src/config'

describe('finance-domain 插件契约', () => {
  it('插件名为 finance-domain', () => {
    expect(name).toBe('finance-domain')
  })

  it('inject 与 cordis.patch.yml 保持一致', () => {
    expect(inject).toEqual(['tools', 'skills', 'fs'])
  })

  it('apply 暴露为可调用函数', () => {
    expect(typeof apply).toBe('function')
  })
})

describe('finance-domain 配置层', () => {
  it('缺省返回默认配置', () => {
    expect(resolveConfig()).toEqual(DEFAULT_FINANCE_DOMAIN_CONFIG)
  })

  it('传入部分字段时覆盖默认值', () => {
    expect(resolveConfig({ logLevel: 'warn' })).toEqual({ logLevel: 'warn' })
  })
})
