/**
 * M0 组合验证用的最小 DomainPack（demo）。
 *
 * 只验证「跨包注入 + 一键安装」这条装配链路是否成立，不含任何业务能力：
 * 一个人设、一个种子 SKILL、一个 `demo_echo` 工具、一个资产分区。
 *
 * 类型全部来自 `dsh-rsi-agent` 的公开导出；本文件不触碰 core 的内部实现。
 */
import type { DomainPack, ToolDefinition } from 'dsh-rsi-agent'

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

/**
 * demo 种子 SKILL 正文（原种子 SKILL 内容，契约升级后改为注册式落盘）。
 *
 * 必须带合法 YAML frontmatter：`skill-filesystem` provider 只收录含
 * `name` + `description` frontmatter 的 `SKILL.md`，缺 frontmatter 的文件会被
 * 静默忽略（上游行为，core 不额外兜底）。
 */
const DEMO_SKILL_MARKDOWN = [
  '---',
  'name: demo-skill',
  'description: M0 组合验证用的种子 SKILL：演示领域包资产 bootstrap 与技能发现链路。',
  'whenToUse: 需要在 demo 领域验证种子 SKILL 是否被 provider 收录时使用。',
  '---',
  '',
  '# demo-skill',
  '',
  '这是 M0 组合验证用的种子 SKILL 内容。',
  '',
].join('\n')

/** demo 领域包。 */
export const demoPack: DomainPack = {
  apiVersion: 1,
  id: 'demo',
  displayName: 'Demo Domain',
  version: '0.1.0',
  defaultSessionId: 'demo',
  persona: {
    markdown: () => '# Demo Persona\n\n你是 demo 领域代理。',
  },
  assets: {
    types: [
      { name: 'record', prefix: 'records/' },
      { name: 'skill', prefix: 'skills/' },
    ],
    /**
     * 注册式资产入口（§11.1）：种子 SKILL 以 `skills/` 下的文件形式落盘。
     * 必须**同步**；抛错会让 core 回滚整个 install。
     */
    bootstrap(writer) {
      writer.register({
        type: 'skill',
        path: 'skills/demo-skill/SKILL.md',
        content: DEMO_SKILL_MARKDOWN,
        message: 'seed demo skill',
      })
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
