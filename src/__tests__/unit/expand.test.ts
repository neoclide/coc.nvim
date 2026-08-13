import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'os'
import path from 'path'
import { expandVariables } from '../../util/expand'

describe('expandVariables', () => {
  it('expands context-free variables', () => {
    assert.strictEqual(expandVariables('${userHome}'), os.homedir())
    assert.strictEqual(expandVariables('${tmpdir}'), os.tmpdir())
    assert.strictEqual(expandVariables('${cwd}'), process.cwd())
    assert.strictEqual(expandVariables('${env:NODE_ENV}'), 'test')
  })

  it('keeps unknown or unresolved placeholders untouched', () => {
    assert.strictEqual(expandVariables('${unknown}'), '${unknown}')
    assert.strictEqual(expandVariables('${env:NOT_EXISTS}'), '${env:NOT_EXISTS}')
    assert.strictEqual(expandVariables('${env:}'), '${env:}')
    // workspace/file vars require ctx
    assert.strictEqual(expandVariables('${workspaceFolder}'), '${workspaceFolder}')
    assert.strictEqual(expandVariables('${file}'), '${file}')
    assert.strictEqual(expandVariables('${fileBasenameNoExtension}'), '${fileBasenameNoExtension}')
  })

  it('expands with a context', () => {
    const ctx = { root: '/tmp/proj', file: '/tmp/proj/src/index.ts', cwd: '/tmp' }
    assert.strictEqual(expandVariables('${workspaceFolder}', ctx), '/tmp/proj')
    assert.strictEqual(expandVariables('${workspace}', ctx), '/tmp/proj')
    assert.strictEqual(expandVariables('${workspaceRoot}', ctx), '/tmp/proj')
    assert.strictEqual(expandVariables('${workspaceFolderBasename}', ctx), 'proj')
    assert.strictEqual(expandVariables('${cwd}', ctx), '/tmp')
    assert.strictEqual(expandVariables('${file}', ctx), '/tmp/proj/src/index.ts')
    assert.strictEqual(expandVariables('${fileDirname}', ctx), path.dirname(ctx.file))
    assert.strictEqual(expandVariables('${fileExtname}', ctx), '.ts')
    assert.strictEqual(expandVariables('${fileBasename}', ctx), 'index.ts')
    assert.strictEqual(expandVariables('${fileBasenameNoExtension}', ctx), 'index')
  })

  it('expands multiple placeholders in one string', () => {
    const ctx = { root: '/tmp/proj' }
    assert.strictEqual(
      expandVariables('${workspaceFolderBasename}/.cache/${env:NODE_ENV}', ctx),
      'proj/.cache/test'
    )
  })
})
