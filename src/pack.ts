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
  skills: {
    evolvable: [
      {
        name: 'demo-skill',
        description: 'M0 组合验证用的种子 SKILL',
        markdown: '# demo-skill\n\n这是 M0 组合验证用的种子 SKILL 内容。\n',
      },
    ],
  },
  tools: () => [demoTool],
  toolNames: ['demo_echo'],
  assetTypes: [
    {
      name: 'records',
      prefix: 'records/',
      description: 'demo 领域的记录资产分区',
    },
  ],
  scheduler: {
    timezone: 'Asia/Shanghai',
  },
  evolutionPolicy: {
    window: '7d',
    independentCases: 5,
  },
}
