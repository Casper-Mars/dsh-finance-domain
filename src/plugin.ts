/**
 * `finance-domain` 插件契约层：声明 Cordis 插件三要素（name / inject / apply）。
 *
 * 本包是 `dsh-rsi-agent` 的领域包。M0 组合验证只需证明一件事：
 * 只声明 `agentHost` 一个跨包服务，就能拿到 core 提供的宿主并把领域安装进去。
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type FinanceDomainConfig } from './config.js'
import { demoPack } from './pack.js'

/** 插件唯一标识。 */
export const name = 'finance-domain'

/**
 * 依赖服务：只声明 core 提供的 `agentHost`（跨包注入验证点）。
 *
 * 必须与 `cordis.patch.yml` 中对应条目的 `inject` 逐项一致。
 */
export const inject = ['agentHost']

/** 插件装配入口。 */
export function apply(ctx: Context, config: Partial<FinanceDomainConfig> = {}): void {
  const resolved = resolveConfig(config)
  void resolved

  // install 返回的 Disposable 交给 ctx.effect 管理：fiber 卸载时自动拆卸领域。
  ctx.effect(() => ctx.agentHost.install(demoPack), 'finance-domain:install-demo-pack')
}
