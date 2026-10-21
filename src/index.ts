/**
 * `dsh-finance-domain` 包入口：汇聚导出 Cordis 插件三要素与配置层。
 *
 * `package.json` 的 `exports["."]` 指向本文件的编译产物
 * （`dist-server/index.js`），实际契约收敛在 `./plugin.js`。
 */
export { name, apply, inject } from './plugin.js'
export {
  DEFAULT_FINANCE_DOMAIN_CONFIG,
  resolveConfig,
  type FinanceDomainConfig,
  type LogLevel,
} from './config.js'
