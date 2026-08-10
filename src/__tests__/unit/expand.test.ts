import os from 'os'
import path from 'path'
import { expandVariables } from '../../util/expand'

describe('expandVariables', () => {
  it('expands context-free variables', () => {
    expect(expandVariables('${userHome}')).toBe(os.homedir())
    expect(expandVariables('${tmpdir}')).toBe(os.tmpdir())
    expect(expandVariables('${cwd}')).toBe(process.cwd())
    expect(expandVariables('${env:NODE_ENV}')).toBe('test')
  })

  it('keeps unknown or unresolved placeholders untouched', () => {
    expect(expandVariables('${unknown}')).toBe('${unknown}')
    expect(expandVariables('${env:NOT_EXISTS}')).toBe('${env:NOT_EXISTS}')
    expect(expandVariables('${env:}')).toBe('${env:}')
    // workspace/file vars require ctx
    expect(expandVariables('${workspaceFolder}')).toBe('${workspaceFolder}')
    expect(expandVariables('${file}')).toBe('${file}')
  })

  it('expands with a context', () => {
    const ctx = { root: '/tmp/proj', file: '/tmp/proj/src/index.ts', cwd: '/tmp' }
    expect(expandVariables('${workspaceFolder}', ctx)).toBe('/tmp/proj')
    expect(expandVariables('${workspace}', ctx)).toBe('/tmp/proj')
    expect(expandVariables('${workspaceRoot}', ctx)).toBe('/tmp/proj')
    expect(expandVariables('${workspaceFolderBasename}', ctx)).toBe('proj')
    expect(expandVariables('${cwd}', ctx)).toBe('/tmp')
    expect(expandVariables('${file}', ctx)).toBe('/tmp/proj/src/index.ts')
    expect(expandVariables('${fileDirname}', ctx)).toBe(path.dirname(ctx.file))
    expect(expandVariables('${fileExtname}', ctx)).toBe('.ts')
    expect(expandVariables('${fileBasename}', ctx)).toBe('index.ts')
    expect(expandVariables('${fileBasenameNoExtension}', ctx)).toBe('index')
  })

  it('expands multiple placeholders in one string', () => {
    const ctx = { root: '/tmp/proj' }
    expect(expandVariables('${workspaceFolderBasename}/.cache/${env:NODE_ENV}', ctx))
      .toBe('proj/.cache/test')
  })
})
