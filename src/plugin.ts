/**
 * `finance-domain` 插件契约层：声明 Cordis 插件三要素（name / inject / apply）。
 *
 * 本包是 `dsh-rsi-agent` 的领域包：向 core 提供金融领域的工具、技能与知识资产。
 * Task-01 仅建立可编译骨架，领域资产装配在后续任务中补入。
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type FinanceDomainConfig } from './config.js'

/** 插件唯一标识。 */
export const name = 'finance-domain'

/**
 * 依赖服务（契约固定）：
 *   - `tools`  —— dsh 工具注册表
 *   - `skills` —— dsh 技能注册表
 *   - `fs`     —— cordis 标准文件系统服务
 *
 * 必须与 `cordis.patch.yml` 中对应条目的 `inject` 逐项一致。
 */
export const inject = ['tools', 'skills', 'fs']

/** 插件装配入口。 */
export function apply(ctx: Context, config: Partial<FinanceDomainConfig> = {}): void {
  const resolved = resolveConfig(config)
  void ctx
  void resolved
}
