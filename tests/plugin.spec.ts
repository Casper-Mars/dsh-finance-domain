import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { AgentHost, validateDomainPack } from 'dsh-rsi-agent'
import { apply, inject, name } from '../src/plugin'
import { demoPack } from '../src/pack'
import { DEFAULT_FINANCE_DOMAIN_CONFIG, resolveConfig } from '../src/config'

describe('finance-domain 插件契约', () => {
  it('插件名为 finance-domain', () => {
    expect(name).toBe('finance-domain')
  })

  it('inject 与 cordis.patch.yml 保持一致（只注入跨包 agentHost）', () => {
    expect(inject).toEqual(['agentHost'])
  })

  it('apply 暴露为可调用函数', () => {
    expect(typeof apply).toBe('function')
  })
})

describe('demo DomainPack 契约', () => {
  it('通过 core 的公开校验（validateDomainPack）', () => {
    const validated = validateDomainPack(demoPack)
    expect(validated.toolNames).toEqual(['demo_echo'])
    expect(validated.personaMarkdown).toContain('Demo Persona')
  })

  it('assets.types 声明 record / skill 两个不重叠分区', () => {
    expect(demoPack.assets.types.map((item) => [item.name, item.prefix])).toEqual([
      ['record', 'records/'],
      ['skill', 'skills/'],
    ])
    expect(demoPack.firmwareSkills).toEqual([])
  })

  it('install 时 bootstrap 把种子 SKILL 真的落到 skills/demo-skill/SKILL.md', () => {
    const home = mkdtempSync(join(tmpdir(), 'finance-domain-'))
    try {
      const host = new AgentHost(new Context())
      const dispose = host.install(demoPack, { home })
      const file = join(host.active!.runtime.assetsDir, 'skills', 'demo-skill', 'SKILL.md')
      expect(existsSync(file)).toBe(true)
      expect(readFileSync(file, 'utf8')).toContain('M0 组合验证用的种子 SKILL')
      dispose()
      expect(host.active).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('demo_echo 是异步 execute，并回显 text', async () => {
    const [tool] = demoPack.tools({} as never, {} as never)
    expect(tool.name).toBe('demo_echo')
    const result = tool.execute({ text: 'hi' }, {} as never)
    expect(result, 'execute 必须返回 Promise（dsh-tools 契约）').toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual({ echoed: 'hi' })
  })

  it('demo_echo 声明 output { schema, render }（否则 dsh-tools 拒绝注册）', () => {
    const [tool] = demoPack.tools({} as never, {} as never)
    expect(tool.output).toBeDefined()
    expect(tool.output.schema).toMatchObject({
      type: 'object',
      required: ['echoed'],
      additionalProperties: false,
    })
    expect(typeof tool.output.render).toBe('function')
    const blocks = tool.output.render({}, { echoed: 'ping' })
    expect(blocks).toEqual([{ type: 'text', text: '{"echoed":"ping"}' }])
  })
  it('demo_echo 能被真实 dsh-tools 注册表接受（不再 TypeError）', async () => {
    const ctx = new Context()
    // ToolRuntime 声明了 inject: ['systemPrompt']，用 no-op 桩提供。
    ctx.provide(
      'systemPrompt',
      new Proxy(
        {},
        { get: (_t, property) => (property === 'then' ? undefined : () => () => {}) },
      ) as never,
    )
    ctx.plugin(ToolRuntime)
    const deadline = Date.now() + 1000
    while (ctx.tools === undefined) {
      if (Date.now() > deadline) throw new Error('ToolRuntime 未上线')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const [tool] = demoPack.tools({} as never, {} as never)
    const unregister = ctx.tools.register(tool)
    expect(ctx.tools.get('demo_echo')).toBeDefined()
    unregister()
    expect(ctx.tools.get('demo_echo')).toBeUndefined()
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
