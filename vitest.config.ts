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
    setupFiles: ['./vitest.setup.ts'],
    clearMocks: true,
    pool: 'forks',
    projects: [
      {
        extends: true,
        test: {
          name: 'parallel',
          include: ['src/__tests__/**/*.{test,spec}.ts'],
          exclude: ['src/__tests__/completion/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'sequential',
          include: ['src/__tests__/completion/**/*.{test,spec}.ts'],
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
    },
  },
})
