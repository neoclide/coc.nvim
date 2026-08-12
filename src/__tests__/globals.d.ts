declare global {
  const afterAll: typeof import('node:test').after
  const afterEach: typeof import('node:test').afterEach
  const assert: typeof import('node:assert')
  const beforeAll: typeof import('node:test').before
  const beforeEach: typeof import('node:test').beforeEach
  const describe: typeof import('node:test').describe
  const it: typeof import('node:test').it
  const test: typeof import('node:test').test
}

export {}
