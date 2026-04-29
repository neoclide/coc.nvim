import { defineConfig } from 'vitest/config'
import path from 'path'

const SRC_ROOT = path.resolve(__dirname, 'src')

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
    include: ['src/__tests__/**/*.{test,spec}.ts'],
    setupFiles: ['./vitest.setup.ts'],
    clearMocks: true,
    pool: 'forks',
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
    },
  },
})
