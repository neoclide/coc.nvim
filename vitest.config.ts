import { execSync } from 'node:child_process'
import { relative } from 'node:path'
import { defineConfig } from 'vitest/config'
import { BaseSequencer } from 'vitest/node'
import type { TestSpecification } from 'vitest/node'

const SLOW_TEST_DURATION = 1000

function runCommand(command: string) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

class SlowFirstSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files)
    return sorted.sort((a, b) => {
      const groupOrderDiff = a.project.config.sequence.groupOrder - b.project.config.sequence.groupOrder
      if (groupOrderDiff !== 0) return groupOrderDiff
      const aSlow = this.isSlow(a) ? 0 : 1
      const bSlow = this.isSlow(b) ? 0 : 1
      return aSlow - bSlow
    })
  }

  private isSlow(spec: TestSpecification): boolean {
    const key = `${spec.project.name}:${relative(this.ctx.config.root, spec.moduleId)}`
    const result = this.ctx.cache.getFileTestResults(key)
    return result ? result.duration > SLOW_TEST_DURATION : false
  }
}

export default defineConfig({
  plugins: [],
  test: {
    sequence: {
      sequencer: SlowFirstSequencer,
    },
    globals: true,
    experimental: {
      fsModuleCache: true,
    },
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    clearMocks: true,
    projects: [{
      extends: true,
      test: {
        name: 'parallel-no-isolate',
        pool: 'threads',
        isolate: false,
        // globalSetup
        include: runCommand('rg --files-without-match -F \'await helper.setup\' -g \'*.test.ts\' src/__tests__'),
        exclude: ['src/__tests__/unit/configurationModel.test.ts'],
      },
    }, {
      extends: true,
      test: {
        name: 'parallel-isolate',
        isolate: true,
        pool: 'forks',
        include: [...runCommand('rg -l -F \'await helper.setup\' -g \'*.test.ts\' src/__tests__'), 'src/__tests__/unit/configurationModel.test.ts'],
        exclude: ['src/__tests__/vim.test.ts'],
      },
    }, {
      extends: true,
      test: {
        pool: 'forks',
        name: 'sequential-vim',
        env: { VIM_NODE_RPC: '1' },
        include: ['src/__tests__/vim.test.ts'],
      },
    }],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
    },
  },
})
