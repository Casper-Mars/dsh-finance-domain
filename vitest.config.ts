import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置。
 *
 * Task-01 阶段仅有骨架级用例；`passWithNoTests` 保证测试集为空时也能以
 * 成功状态退出，便于 CI 在骨架期直接接入。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
