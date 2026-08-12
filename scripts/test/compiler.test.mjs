import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {after, before, describe, it} from 'node:test'
import {TestCompiler} from './compiler.mjs'

describe('main-process test compiler', () => {
  let root
  let compiler

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-test-compiler-'))
    await fs.mkdir(path.join(root, 'src', '__tests__', 'unit'), {recursive: true})
    await fs.writeFile(path.join(root, 'tsconfig.test.json'), JSON.stringify({compilerOptions: {strict: true}}))
    await fs.writeFile(path.join(root, 'src', '__tests__', 'shared.ts'), "export const shared: number = 1\n")
    await fs.writeFile(path.join(root, 'src', '__tests__', 'unused.ts'), "export const unused: number = 2\n")
    await fs.writeFile(path.join(root, 'src', '__tests__', 'cycle-a.ts'), "export { b } from './cycle-b'\nexport const a = 1\n")
    await fs.writeFile(path.join(root, 'src', '__tests__', 'cycle-b.ts'), "export { a } from './cycle-a'\nexport const b = 2\n")
    await fs.writeFile(
      path.join(root, 'src', '__tests__', 'unit', 'one.test.ts'),
      "import { shared } from '../shared'\nexport default shared\n"
    )
    await fs.writeFile(
      path.join(root, 'src', '__tests__', 'unit', 'two.test.ts'),
      "export default 2\n"
    )
    await fs.writeFile(
      path.join(root, 'src', '__tests__', 'unit', 'cycle.test.ts'),
      "import { a } from '../cycle-a'\nexport default a\n"
    )
    compiler = new TestCompiler(root)
    await compiler.compileTests([
      'src/__tests__/unit/one.test.ts',
      'src/__tests__/unit/two.test.ts',
      'src/__tests__/unit/cycle.test.ts',
    ])
    await compiler.compileFile('src/__tests__/unused.ts', false)
  })

  after(async () => {
    await fs.rm(root, {recursive: true, force: true})
  })

  it('records compiled files and dependency relationships', () => {
    const entry = compiler.recordFor('src/__tests__/unit/one.test.ts')
    assert.deepEqual(entry.dependencies, [path.join(root, 'src', '__tests__', 'shared.ts')])
    assert.equal(compiler.dependencies.get(entry.file).has(entry.dependencies[0]), true)
    assert.equal(compiler.dependents.get(entry.dependencies[0]).has(entry.file), true)
    assert.equal(entry.lane, 'unit')
    assert.equal(entry.editor, undefined)
    assert.match(entry.source, /from "\.\.\/shared"/)
  })

  it('returns only the requested entry dependency closure', () => {
    const records = compiler.recordsFor(['src/__tests__/unit/one.test.ts'])
    assert.deepEqual(
      records.map(record => path.relative(root, record.file)),
      ['src/__tests__/unit/one.test.ts', 'src/__tests__/shared.ts']
    )
  })

  it('records cyclic test helper dependencies without blocking', () => {
    const records = compiler.recordsFor(['src/__tests__/unit/cycle.test.ts'])
    assert.deepEqual(
      records.map(record => path.relative(root, record.file)),
      [
        'src/__tests__/unit/cycle.test.ts',
        'src/__tests__/cycle-a.ts',
        'src/__tests__/cycle-b.ts',
      ]
    )
  })

  it('selects only the requested execution endpoint dependency closure', () => {
    const records = compiler.recordsFor(['src/__tests__/unit/two.test.ts'])
    assert.deepEqual(
      records.map(record => path.relative(root, record.file)),
      ['src/__tests__/unit/two.test.ts']
    )
  })
})
