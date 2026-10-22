/**
 * demo 领域包（Task-13）契约 / bootstrap / validate / 源码卫生 / 真实 core 集成。
 *
 * 分两层：
 *   - **纯函数层**：形状、路径派生、内容校验反例 —— 不需要任何 IO；
 *   - **集成层**：用 core 的真实 `AgentHost.install` 在临时 home 下落盘 + git 提交，
 *     验证「一次 register ⇒ 一次 commit」「失败零副作用」「拆卸后人设回退」。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  AgentHost,
  GIT_IDENTITY_NAME,
  loadCorePersonaMarkdown,
  validateDomainPack,
  type AssetSpec,
  type AssetWriter,
  type DomainPack,
} from 'dsh-rsi-agent'
import { demoPack } from '../src/pack'

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 捕获 bootstrap 期间对 writer 的调用（不落盘）。 */
function captureWriter(): { calls: AssetSpec[][]; writer: AssetWriter } {
  const calls: AssetSpec[][] = []
  const writer: AssetWriter = {
    register(input) {
      calls.push(Array.isArray(input) ? [...input] : [input as AssetSpec])
      return []
    },
    list: () => [],
    read: () => {
      throw new Error('capture writer 不提供 read')
    },
  }
  return { calls, writer }
}

/** 取出 demoPack 在 bootstrap 里注册的全部 spec（真源，不手抄）。 */
function bootstrapSpecs(): AssetSpec[] {
  const { calls, writer } = captureWriter()
  demoPack.assets.bootstrap?.(writer)
  expect(calls.length, 'bootstrap 必须只调用一次 register（一次调用 ⇒ 一次 commit）').toBe(1)
  return calls[0] as AssetSpec[]
}

/** 按类型名取资产类型声明。 */
function assetType(typeName: string) {
  const found = demoPack.assets.types.find((item) => item.name === typeName)
  if (found === undefined) throw new Error(`demoPack 未声明资产类型 "${typeName}"`)
  return found
}

/** 递归快照：相对路径 → 文件内容（跳过 `.git` 内部，避免与本任务无关的字节噪音）。 */
function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (current: string, prefix: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const absolute = join(current, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walk(absolute, relative)
      } else if (statSync(absolute).isFile()) {
        result[relative] = readFileSync(absolute, 'utf8')
      }
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return result
}

/** 读取 assets 仓库最近一次提交的指定字段。 */
function gitLast(assetsDir: string, format: string): string {
  return execFileSync('git', ['-C', assetsDir, 'log', '-1', `--format=${format}`], {
    encoding: 'utf8',
  }).trim()
}

/** 提交总数。 */
function gitCommitCount(assetsDir: string): number {
  const out = execFileSync('git', ['-C', assetsDir, 'rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  return Number(out)
}

/** 由 demoPack 派生出一个「skill frontmatter.name 与目录名不一致」的坏 pack。 */
function brokenSkillPack(): DomainPack {
  const specs = bootstrapSpecs().map((spec) =>
    spec.type === 'skill'
      ? { ...spec, content: spec.content.replace('name: demo-skill', 'name: wrong-skill') }
      : spec,
  )
  return {
    ...demoPack,
    assets: {
      types: demoPack.assets.types,
      bootstrap(writer: AssetWriter) {
        writer.register(specs)
      },
    },
  }
}

const temporaryHomes: string[] = []

/** 建一个临时 home（每个用例独立，失败也不污染其它用例）。 */
function tempHome(label: string): string {
  const home = mkdtempSync(join(tmpdir(), `demo-pack-${label}-`))
  temporaryHomes.push(home)
  return home
}

afterEach(() => {
  while (temporaryHomes.length > 0) {
    rmSync(temporaryHomes.pop() as string, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ *
 * 1. pack 契约
 * ------------------------------------------------------------------ */

describe('demoPack 字段契约', () => {
  it('身份字段齐全且版本未被回退', () => {
    expect(demoPack.apiVersion).toBe(1)
    expect(demoPack.id).toBe('demo')
    expect(demoPack.displayName).toBeTruthy()
    expect(demoPack.defaultSessionId).toBe('demo')
    // Task-01 已定版 0.1.0：不允许回退到 0.0.1。
    expect(demoPack.version).toBe('0.1.0')
  })

  it('openingNotice 非空、合法 UTF-8、≤ 4096 字节，且说明这是 demo 夹具', () => {
    const notice = demoPack.openingNotice
    expect(typeof notice).toBe('string')
    expect((notice as string).trim().length).toBeGreaterThan(0)
    expect(Buffer.from(notice as string, 'utf8').toString('utf8')).toBe(notice)
    expect(Buffer.byteLength(notice as string, 'utf8')).toBeLessThanOrEqual(4096)
    expect(notice as string).toContain('demo')
  })

  it('通过 core 的公开校验（含 openingNotice / assets / tools）', () => {
    const validated = validateDomainPack(demoPack)
    expect(validated.toolNames).toEqual(['demo_echo'])
  })

  it('两种 assetType 前缀互不重叠，且都以 / 结尾', () => {
    const types = demoPack.assets.types
    expect(types).toHaveLength(2)
    for (const item of types) {
      expect(item.prefix.endsWith('/')).toBe(true)
      expect(item.prefix.startsWith('/')).toBe(false)
    }
    const [first, second] = types
    // 路径段级比较的简化版：两个扁平前缀互不为对方前缀。
    expect((first as { prefix: string }).prefix.startsWith((second as { prefix: string }).prefix)).toBe(false)
    expect((second as { prefix: string }).prefix.startsWith((first as { prefix: string }).prefix)).toBe(false)
  })

  it('toolNames 与 tools() 实际返回完全一致', () => {
    const returned = demoPack.tools({} as never, {} as never).map((tool) => tool.name)
    expect([...demoPack.toolNames].sort()).toEqual([...returned].sort())
  })

  it('bootstrap 是同步函数（async 会让 core 判安装失败）', () => {
    const bootstrap = demoPack.assets.bootstrap
    expect(typeof bootstrap).toBe('function')
    expect((bootstrap as { constructor: { name: string } }).constructor.name).not.toBe('AsyncFunction')

    const { writer } = captureWriter()
    const returned = bootstrap?.(writer) as unknown
    // 同步 = 返回值不是 thenable。
    expect(returned).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ *
 * 2. bootstrap 行为
 * ------------------------------------------------------------------ */

describe('assets.bootstrap 资产自注册', () => {
  it('一次 register 注册 1 个 skill + 1 个 record，message 非空且路径落在各自 prefix 下', () => {
    const specs = bootstrapSpecs()
    expect(specs).toHaveLength(2)
    expect(specs.map((spec) => spec.type).sort()).toEqual(['record', 'skill'])

    for (const spec of specs) {
      const type = assetType(spec.type)
      expect(spec.path.startsWith(type.prefix), `${spec.path} 必须落在 ${type.prefix} 下`).toBe(true)
      expect(typeof spec.message).toBe('string')
      expect((spec.message as string).trim().length).toBeGreaterThan(0)
    }

    const skill = specs.find((spec) => spec.type === 'skill') as AssetSpec
    const record = specs.find((spec) => spec.type === 'record') as AssetSpec
    expect(skill.path).toBe(`${assetType('skill').prefix}demo-skill/SKILL.md`)
    expect(record.path).toBe(`${assetType('record').prefix}demo-record.json`)
    expect(skill.message).toContain('skill')
    expect(record.message).toContain('record')
  })

  it('每个 bootstrap 产物都通过自己类型的 validate（正例）', () => {
    for (const spec of bootstrapSpecs()) {
      expect(() => assetType(spec.type).validate?.(spec.path, spec.content)).not.toThrow()
    }
  })
})

/* ------------------------------------------------------------------ *
 * 3. validate 反例（纯函数，无 IO）
 * ------------------------------------------------------------------ */

describe('assets.types[].validate 语义校验', () => {
  const skillType = assetType('skill')
  const recordType = assetType('record')
  const skillPath = `${skillType.prefix}demo-skill/SKILL.md`

  it('frontmatter.name 与目录名不一致 → 抛错且消息含两者', () => {
    const content = [
      '---',
      'name: other-skill',
      'description: 随便写点什么',
      '---',
      '',
      '# other-skill',
    ].join('\n')

    expect(() => skillType.validate?.(skillPath, content)).toThrowError(/other-skill/)
    try {
      skillType.validate?.(skillPath, content)
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('other-skill')
      expect(message).toContain('demo-skill')
    }
  })

  it('缺少 frontmatter → 抛错', () => {
    expect(() => skillType.validate?.(skillPath, '# 没有 frontmatter\n')).toThrowError(/frontmatter/)
  })

  it('description 为空 → 抛错', () => {
    const content = ['---', 'name: demo-skill', 'description:   ', '---', ''].join('\n')
    expect(() => skillType.validate?.(skillPath, content)).toThrowError(/description/)
  })

  it('name 缺失 → 抛错', () => {
    const content = ['---', 'description: 只有描述', '---', ''].join('\n')
    expect(() => skillType.validate?.(skillPath, content)).toThrowError(/name/)
  })

  it('skill 路径形状不合法 → 抛错（不允许把 SKILL.md 直接放在 prefix 根）', () => {
    expect(() => skillType.validate?.(`${skillType.prefix}SKILL.md`, '---\nname: x\n---\n')).toThrowError(
      /SKILL\.md/,
    )
  })

  it('record 非法 JSON → 抛错', () => {
    expect(() => recordType.validate?.(`${recordType.prefix}demo-record.json`, '{oops')).toThrowError(/JSON/)
  })

  it('record 缺 kind 字符串 → 抛错', () => {
    expect(() =>
      recordType.validate?.(`${recordType.prefix}demo-record.json`, JSON.stringify({ note: 'no kind' })),
    ).toThrowError(/kind/)
    expect(() =>
      recordType.validate?.(`${recordType.prefix}demo-record.json`, JSON.stringify({ kind: 1 })),
    ).toThrowError(/kind/)
  })
})

/* ------------------------------------------------------------------ *
 * 4. 源码卫生
 * ------------------------------------------------------------------ */

describe('源码卫生', () => {
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

  function sourceFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...sourceFiles(absolute))
      else if (entry.name.endsWith('.ts')) files.push(absolute)
    }
    return files
  }

  it('只 import core 的公开导出（禁止 dsh-rsi-agent/dist-server 与 /src 深层路径）', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      const content = readFileSync(file, 'utf8')
      if (/dsh-rsi-agent\/(?!['"])/.test(content) || /dsh-rsi-agent\/(dist-server|src|dist)/.test(content)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it("不出现裸的 'skills/' / 'records/' 字面量（types 声明行除外，路径由常量派生）", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/['"](skills|records)\//.test(line)) return
        // 允许：资产类型声明行（唯一真源）。
        if (/prefix:\s*['"](skills|records)\//.test(line)) return
        offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 5. 真实 core 集成（AgentHost.install）
 * ------------------------------------------------------------------ */

describe('真实 core 集成：install / 提交 / 失败零副作用 / 拆卸', () => {
  it('install 成功：两类资产落盘，作者为 dsh-rsi-agent，一批只产生一个提交', () => {
    const home = tempHome('install')
    const host = new AgentHost(new Context())
    const dispose = host.install(demoPack, { home })
    try {
      const assetsDir = host.active?.runtime.assetsDir as string
      expect(existsSync(join(assetsDir, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(assetsDir, 'records', 'demo-record.json'))).toBe(true)

      expect(gitLast(assetsDir, '%an')).toBe(GIT_IDENTITY_NAME)

      // core 的提交说明 = 各 spec 的 `<path>: <message>` 首段 + 动作行（`assets: create ...`）。
      // 因此「create」位于 body 而非 subject（subject 只取首行）。
      const full = gitLast(assetsDir, '%B')
      expect(full).toContain('create')
      expect(full).toContain('seed demo skill (domain bootstrap)')
      expect(full).toContain('seed demo record (domain bootstrap)')

      const subject = gitLast(assetsDir, '%s')
      expect(subject).toContain('seed demo skill (domain bootstrap)')
      expect(subject).toContain('skills/demo-skill/SKILL.md')

      // 一次 register = 一个 commit；加上仓库初始化的 `chore: init assets repository` 共 2 个。
      expect(gitCommitCount(assetsDir)).toBe(2)
    } finally {
      dispose()
    }
  })

  it('skill frontmatter.name 不匹配 → install 抛错，assets 下无任何新文件', () => {
    const home = tempHome('negative')
    const host = new AgentHost(new Context())
    // 先做一次合法安装：把仓库与种子文件准备好，再记录快照做严格比对。
    const dispose = host.install(demoPack, { home })
    const assetsDir = host.active?.runtime.assetsDir as string
    dispose()

    const before = snapshot(assetsDir)

    const broken = brokenSkillPack()
    expect(() => host.install(broken, { home })).toThrowError(/与目录名不一致|wrong-skill/)

    expect(snapshot(assetsDir)).toEqual(before)
  })

  it('async bootstrap → install 抛错并点明必须同步，且一个字都没写', () => {
    const home = tempHome('async')
    const asyncPack: DomainPack = {
      ...demoPack,
      assets: {
        types: demoPack.assets.types,
        // 故意写成 async（领域作者最常见的错误）。
        async bootstrap(writer: AssetWriter) {
          writer.register(bootstrapSpecs())
        },
      },
    }

    const host = new AgentHost(new Context())
    expect(() => host.install(asyncPack, { home })).toThrowError(/同步/)
    expect(snapshot(join(home, 'demo', 'assets'))).toEqual({})
  })

  it('dispose 后：persona 恢复 core 兜底，资产文件仍在', async () => {
    const sections: Array<{ name: string; order: number; text: string | ((ctx: unknown) => string) }> = []
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      section(section: (typeof sections)[number]) {
        sections.push(section)
        return () => {
          const index = sections.indexOf(section)
          if (index >= 0) sections.splice(index, 1)
        }
      },
    } as never)

    const home = tempHome('dispose')
    const host = new AgentHost(ctx)

    // persona section 通过 ctx.inject 动态挂载，等一拍让它就位。
    const deadline = Date.now() + 2000
    while (!sections.some((section) => section.name === 'rsi-agent:persona')) {
      if (Date.now() > deadline) throw new Error('persona section 未挂载')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const personaText = (): string => {
      const section = sections.find((item) => item.name === 'rsi-agent:persona')
      if (section === undefined) throw new Error('persona section 不存在')
      return typeof section.text === 'function' ? section.text({}) : section.text
    }

    const dispose = host.install(demoPack, { home })
    const assetsDir = host.active?.runtime.assetsDir as string
    expect(personaText()).toContain('Demo Persona')

    dispose()

    expect(host.active).toBeUndefined()
    expect(personaText()).toBe(loadCorePersonaMarkdown())
    // 磁盘资产按技术方案 §4.3 保留，不随拆卸删除。
    expect(existsSync(join(assetsDir, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(assetsDir, 'records', 'demo-record.json'))).toBe(true)

    await ctx.fiber.dispose()
  }, 20_000)
})
