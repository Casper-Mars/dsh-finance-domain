/**
 * M0 / M3 集成夹具用的最小 DomainPack（demo）。
 *
 * 只验证「跨包注入 + 一键安装 + 领域自己注册自己的可进化资产」这条装配链路，
 * 不含任何业务能力：一个人设、一个开场 notice、一个 `demo_echo` 工具，
 * 以及 bootstrap 里**一次 register** 注册的 1 个 skill + 1 个 record 资产。
 *
 * 契约要点（全部来自 `dsh-rsi-agent` 的公开导出，本文件不触碰 core 内部实现）：
 *   - 资产类型前缀只在 {@link ASSET_TYPES} 里声明一次，bootstrap 的路径一律
 *     由 {@link assetPath} 派生，源码中不出现手拼的路径字面量；
 *   - 资产内容校验放领域自己的 `validate`（纯函数、无 IO），core 不含 skill 语义；
 *   - `bootstrap` 必须**同步**：core 在真实 writer 上同步执行，抛错即整个 install 回滚。
 */
import type { AssetSpec, AssetType, AssetWriter, DomainPack, ToolDefinition } from 'dsh-rsi-agent'

/* ------------------------------------------------------------------ *
 * 资产类型声明（前缀的唯一真源）
 * ------------------------------------------------------------------ */

/** 领域资产类型名：可进化 SKILL。 */
const SKILL_TYPE = 'skill'
/** 领域资产类型名：结构化记录。 */
const RECORD_TYPE = 'record'

/** 种子 SKILL 的目录名（frontmatter.name 必须与之一致）。 */
const DEMO_SKILL_DIR = 'demo-skill'
/** SKILL 文件名（上游 skill-filesystem provider 只认这个文件名）。 */
const DEMO_SKILL_FILE = 'SKILL.md'
/** 种子 record 文件名。 */
const DEMO_RECORD_FILE = 'demo-record.json'

/** 资产前缀读取：类型名 → 已声明前缀（未知类型属于本域编程错误）。 */
function assetPrefix(typeName: string): string {
  const found = ASSET_TYPES.find((item) => item.name === typeName)
  if (found === undefined) {
    throw new Error(`[demo] 未声明的资产类型："${typeName}"`)
  }
  return found.prefix
}

/** 由类型前缀派生资产路径（禁止调用方手拼前缀）。 */
function assetPath(typeName: string, ...segments: string[]): string {
  return assetPrefix(typeName) + segments.join('/')
}

/* ------------------------------------------------------------------ *
 * frontmatter（YAML 子集）解析 —— 纯字符串处理，不引入依赖、不做 IO
 * ------------------------------------------------------------------ */

/** frontmatter 分隔行。 */
const FRONTMATTER_FENCE = '---'

/**
 * 解析 `---` 包裹的 frontmatter，返回 `key → value` 映射。
 *
 * 只支持本领域需要的 YAML 子集：`key: value` 单行标量（可带成对引号）。
 * 不做嵌套 / 数组解析 —— 校验只关心 `name` 与 `description`。
 *
 * @returns 缺少 frontmatter（未以 `---` 开头或无结束行）时返回 `undefined`。
 */
function parseFrontmatter(content: string): Map<string, string> | undefined {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return undefined

  const fields = new Map<string, string>()
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (line.trim() === FRONTMATTER_FENCE) return fields
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    fields.set(key, value)
  }
  // 没有结束行：视为没有 frontmatter（否则会把正文当字段解析）。
  return undefined
}

/** 类型化描述一个未知值，用于错误信息里给出**实际值**。 */
function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined（缺失）'
  if (typeof value === 'string') return JSON.stringify(value)
  return `${typeof value} ${String(value)}`
}

/* ------------------------------------------------------------------ *
 * 资产内容校验（纯函数、无 IO；抛错即整批 register 失败）
 * ------------------------------------------------------------------ */

/**
 * 从 skill 资产路径解出目录名：`<prefix><dir>/SKILL.md`。
 *
 * 路径形状不合法时抛错 —— 形状属于「本域 skill 语义」，因此放在 validate 里，
 * 而不是散落在 bootstrap 的调用处。
 */
function skillDirOf(path: string): string {
  const prefix = assetPrefix(SKILL_TYPE)
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : undefined
  const segments = rest?.split('/') ?? []
  if (segments.length !== 2 || segments[0] === '' || segments[1] !== DEMO_SKILL_FILE) {
    throw new Error(
      `[demo] skill 资产路径必须是 ${prefix}<目录>/${DEMO_SKILL_FILE}，实际为 "${path}"`,
    )
  }
  return segments[0] as string
}

/**
 * skill 资产校验：frontmatter 必须存在，`name` 必须等于目录名，`description` 非空。
 *
 * 为什么 `name` 必须等于目录名：`skill-filesystem` provider 以**目录名**发布技能，
 * 而 frontmatter 的 `name` 是模型侧看到的技能名；两者不一致会让「磁盘上叫 A、
 * 调用时叫 B」，属于领域语义错误，core 不负责判定。
 */
function validateSkillAsset(path: string, content: string): void {
  const dir = skillDirOf(path)
  const frontmatter = parseFrontmatter(content)
  if (frontmatter === undefined) {
    throw new Error(
      `[demo] skill 资产 "${path}" 缺少 YAML frontmatter（必须以 "${FRONTMATTER_FENCE}" 开头并以 "${FRONTMATTER_FENCE}" 结束）`,
    )
  }

  const name = frontmatter.get('name')?.trim()
  if (name === undefined || name === '') {
    throw new Error(
      `[demo] skill 资产 "${path}" 的 frontmatter 缺少非空 name 字段，实际为 ${describeValue(frontmatter.get('name'))}`,
    )
  }
  if (name !== dir) {
    throw new Error(
      `[demo] skill 资产 frontmatter.name 与目录名不一致：name=${describeValue(name)}、目录名=${describeValue(dir)}（路径 "${path}"）`,
    )
  }

  const description = frontmatter.get('description')?.trim()
  if (description === undefined || description === '') {
    throw new Error(
      `[demo] skill 资产 "${path}" 的 frontmatter 缺少非空 description 字段，实际为 ${describeValue(frontmatter.get('description'))}`,
    )
  }
}

/** record 资产校验：必须是 JSON 对象，且含字符串字段 `kind`。 */
function validateRecordAsset(path: string, content: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`[demo] record 资产 "${path}" 不是合法 JSON：${reason}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `[demo] record 资产 "${path}" 必须是 JSON 对象，实际为 ${Array.isArray(parsed) ? '数组' : typeof parsed}`,
    )
  }

  const kind = (parsed as Record<string, unknown>).kind
  if (typeof kind !== 'string') {
    throw new Error(
      `[demo] record 资产 "${path}" 必须含字符串字段 kind，实际为 ${describeValue(kind)}`,
    )
  }
}

/**
 * 资产类型声明。
 *
 * 前缀只在这里出现一次：`prefix` 是路径派生的唯一真源，其它代码一律通过
 * {@link assetPath} / {@link assetPrefix} 取值，避免「改前缀漏改路径」。
 */
const ASSET_TYPES: readonly AssetType[] = [
  { name: SKILL_TYPE, prefix: 'skills/', validate: validateSkillAsset },
  { name: RECORD_TYPE, prefix: 'records/', validate: validateRecordAsset },
]

/* ------------------------------------------------------------------ *
 * 种子资产内容
 * ------------------------------------------------------------------ */

/**
 * demo 种子 SKILL 正文。
 *
 * 必须带合法 YAML frontmatter：`skill-filesystem` provider 只收录含
 * `name` + `description` frontmatter 的 `SKILL.md`，缺 frontmatter 的文件会被
 * 静默忽略（上游行为，core 不额外兜底）。`name` 由 {@link DEMO_SKILL_DIR} 派生，
 * 保证与目录名天然一致（改目录名不会漏改 frontmatter）。
 */
const DEMO_SKILL_MARKDOWN = [
  FRONTMATTER_FENCE,
  `name: ${DEMO_SKILL_DIR}`,
  'description: M0 组合验证用的种子 SKILL：演示领域包资产 bootstrap 与技能发现链路。',
  'whenToUse: 需要在 demo 领域验证种子 SKILL 是否被 provider 收录时使用。',
  FRONTMATTER_FENCE,
  '',
  `# ${DEMO_SKILL_DIR}`,
  '',
  '这是 M0 组合验证用的种子 SKILL 内容。',
  '',
].join('\n')

/** demo 种子 record：最小结构化示例（领域自注册的第二类资产）。 */
const DEMO_RECORD_JSON = `${JSON.stringify(
  { kind: 'demo', note: '领域自注册示例', created: '2026-01-01' },
  null,
  2,
)}\n`

/**
 * 领域开场 notice：只影响首次启动的 blank 会话文案。
 *
 * core 侧约束：非空、合法 UTF-8、UTF-8 字节数 ≤ 4096（见 `OPENING_NOTICE_MAX_BYTES`）。
 */
const OPENING_NOTICE = [
  '这是 dsh 的 demo 领域包（M0/M3 集成夹具）：仅用于验证「跨包注入 + 领域装配 + 资产自注册」链路，不含任何业务逻辑。',
  '开场 notice、人设与 demo_echo 工具都只是集成测试的稳定锚点。',
].join('\n')

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/**
 * 最小演示工具：回显调用方传入的 `text`。
 *
 * 必须符合 dsh-tools 的 `ToolDefinition` 全量契约（不只是“有个 name”）：
 *   - `parameters`：模型侧参数 schema；
 *   - `output: { schema, render }`：**必填**——`schema` 校验返回值，`render` 把
 *     合法返回值投影成 ContentBlock；
 *   - `execute(args, exec)`：**异步**，只返回 `output.schema` 声明的规范值。
 */
const demoTool: ToolDefinition = {
  name: 'demo_echo',
  description: '回显传入的 text（M0 组合验证用）',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要回显的文本' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: { echoed: { type: 'string' } },
      required: ['echoed'],
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  async execute(args) {
    const text = (args as { text?: unknown } | undefined)?.text
    return { echoed: typeof text === 'string' ? text : '' }
  },
}

/* ------------------------------------------------------------------ *
 * 领域包
 * ------------------------------------------------------------------ */

/** demo 领域包。 */
export const demoPack: DomainPack = {
  apiVersion: 1,
  id: 'demo',
  displayName: 'Demo Domain',
  version: '0.1.0',
  defaultSessionId: 'demo',
  openingNotice: OPENING_NOTICE,
  persona: {
    markdown: () => '# Demo Persona\n\n你是 demo 领域代理。',
  },
  assets: {
    types: ASSET_TYPES,
    /**
     * 注册式资产入口（§11.1）。
     *
     * **一次** `register([...])` 注册两类资产：core 会先全量校验（含上面的
     * `validate`），全部通过才落盘，并只产生**一个** commit。因此这里不能
     * 拆成两次 register（会变成两个 commit，失去「一批原子」语义）。
     *
     * 必须**同步**；抛错会让 core 回滚整个 install。
     */
    bootstrap(writer: AssetWriter) {
      const specs: AssetSpec[] = [
        {
          type: SKILL_TYPE,
          path: assetPath(SKILL_TYPE, DEMO_SKILL_DIR, DEMO_SKILL_FILE),
          content: DEMO_SKILL_MARKDOWN,
          message: 'seed demo skill (domain bootstrap)',
        },
        {
          type: RECORD_TYPE,
          path: assetPath(RECORD_TYPE, DEMO_RECORD_FILE),
          content: DEMO_RECORD_JSON,
          message: 'seed demo record (domain bootstrap)',
        },
      ]
      writer.register(specs)
    },
  },
  // demo 领域不自带固有 SKILL；core 内置的三个固件 SKILL 由 core 注册。
  firmwareSkills: [],
  tools: () => [demoTool],
  toolNames: ['demo_echo'],
  scheduler: {
    timezone: 'Asia/Shanghai',
  },
  evolutionPolicy: {
    window: '7d',
    independentCases: 5,
  },
}
