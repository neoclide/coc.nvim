import { execSync } from 'node:child_process'
import path from 'path'
import { defineConfig } from 'vitest/config'

const SRC_ROOT = path.resolve(__dirname, 'src')

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
  plugins: [
    {
      name: 'register-ts-module',
      enforce: 'post',
      transform(code, id) {
        const cleanId = id.split('?')[0]
        if (!cleanId.endsWith('.ts')) return
        if (!cleanId.startsWith(SRC_ROOT)) return
        if (cleanId.includes(`${path.sep}__tests__${path.sep}`)) return
        const append = `\n;(globalThis.__esmModuleCache ||= new Map()).set(${JSON.stringify(cleanId)}, module.exports);`
        return { code: code + append, map: null }
      },
    },
  ],
  test: {
    globals: true,
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
      },
    }, {
      extends: true,
      test: {
        name: 'parallel-isolate',
        isolate: true,
        pool: 'forks',
        detectAsyncLeaks: true,
        include: runCommand('rg -l -F \'await helper.setup\' -g \'*.test.ts\' src/__tests__'),
        exclude: ['src/__tests__/completion/float.test.ts', 'src/__tests__/tree/treeView.test.ts'],
      },
    }, {
      extends: true,
      test: {
        isolate: true,
        pool: 'forks',
        name: 'sequential',
        detectAsyncLeaks: true,
        include: ['src/__tests__/completion/float.test.ts', 'src/__tests__/tree/treeView.test.ts'],
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
