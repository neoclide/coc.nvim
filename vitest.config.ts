import { execSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'

function runCommand(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

export default defineConfig({
  plugins: [],
  test: {
    globals: true,
    maxWorkers: 8,
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
        exclude: ['src/__tests__/configuration/configurationModel.test.ts'],
      },
    }, {
      extends: true,
      test: {
        name: 'parallel-isolate',
        isolate: true,
        pool: 'forks',
        include: [...runCommand('rg -l -F \'await helper.setup\' -g \'*.test.ts\' src/__tests__'), 'src/__tests__/configuration/configurationModel.test.ts'],
        exclude: ['src/__tests__/completion/float.test.ts', 'src/__tests__/vim.test.ts'],
      },
    }, {
      extends: true,
      test: {
        isolate: true,
        pool: 'forks',
        name: 'sequential-vim',
        env: { VIM_NODE_RPC: '1' },
        include: ['src/__tests__/vim.test.ts'],
      },
    }, {
      extends: true,
      test: {
        isolate: true,
        pool: 'forks',
        name: 'sequential',
        include: ['src/__tests__/completion/float.test.ts'],
        fileParallelism: false,
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
