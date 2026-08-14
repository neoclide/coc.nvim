import fs from 'fs'
import os from 'os'
import path from 'path'
import { ExtensionPathIndex, createModuleDescription, isInside } from '../../extension/pathIndex'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-path-index-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

describe('isInside', () => {
  it('should match files below parent', () => {
    assert.strictEqual(isInside('/extensions/foo', '/extensions/foo/index.js'), true)
    assert.strictEqual(isInside('/extensions/foo', '/extensions/foo/dev/bar.js'), true)
  })

  it('should reject prefix collisions', () => {
    assert.strictEqual(isInside('/extensions/foo', '/extensions/foobar/index.js'), false)
    assert.strictEqual(isInside('/extensions/foo', '/extensions/foobar'), false)
  })

  it('should reject parent and sibling files', () => {
    assert.strictEqual(isInside('/extensions/foo', '/extensions/bar/index.js'), false)
    assert.strictEqual(isInside('/extensions/foo', '/extensions/index.js'), false)
    assert.strictEqual(isInside('/extensions/foo', '/other/index.js'), false)
  })

  it('should reject the root itself', () => {
    assert.strictEqual(isInside('/extensions/foo', '/extensions/foo'), false)
  })

  it('should ignore trailing separators', () => {
    assert.strictEqual(isInside('/extensions/foo/', '/extensions/foo/index.js'), true)
    assert.strictEqual(isInside('/extensions/foo', '/extensions/foo/index.js'), true)
  })
})

describe('ExtensionPathIndex', () => {
  it('should find owner for normal paths', () => {
    let folder = createFolder()
    let index = new ExtensionPathIndex()
    let desc = createModuleDescription('foo', folder, path.join(folder, 'index.js'))
    index.update([desc])
    assert.strictEqual(index.findByFile(path.join(folder, 'index.js'))?.id, 'foo')
    assert.strictEqual(index.findByFile(path.join(folder, 'lib', 'dep.js'))?.id, 'foo')
    assert.strictEqual(index.findByFile(path.join(folder, '..', 'other', 'x.js')), undefined)
  })

  it('should not confuse similar prefixes', () => {
    let base = createFolder()
    let foo = path.join(base, 'foo')
    let foobar = path.join(base, 'foobar')
    fs.mkdirSync(foo, { recursive: true })
    fs.mkdirSync(foobar, { recursive: true })
    let index = new ExtensionPathIndex()
    index.update([
      createModuleDescription('foo', foo, path.join(foo, 'index.js')),
      createModuleDescription('foobar', foobar, path.join(foobar, 'index.js'))
    ])
    assert.strictEqual(index.findByFile(path.join(foo, 'a.js'))?.id, 'foo')
    assert.strictEqual(index.findByFile(path.join(foobar, 'a.js'))?.id, 'foobar')
  })

  it('should let the deeper nested root win', () => {
    let base = createFolder()
    let outer = path.join(base, 'ext')
    let inner = path.join(outer, 'dev', 'bar')
    fs.mkdirSync(inner, { recursive: true })
    let index = new ExtensionPathIndex()
    index.update([
      createModuleDescription('outer', outer, path.join(outer, 'index.js')),
      createModuleDescription('inner', inner, path.join(inner, 'index.js'))
    ])
    assert.strictEqual(index.findByFile(path.join(inner, 'dep.js'))?.id, 'inner')
    assert.strictEqual(index.findByFile(path.join(outer, 'dep.js'))?.id, 'outer')
  })

  it('should resolve symlinked roots by real path and logical fallback', () => {
    let base = createFolder()
    let real = path.join(base, 'real')
    let linked = path.join(base, 'linked')
    fs.mkdirSync(real, { recursive: true })
    try {
      fs.symlinkSync(real, linked, 'dir')
    } catch (e) {
      return
    }
    let index = new ExtensionPathIndex()
    let desc = createModuleDescription('sym', linked, path.join(linked, 'index.js'))
    index.update([desc])
    // Node resolves symlinks in module filenames by default: real path matches.
    assert.strictEqual(index.findByFile(path.join(fs.realpathSync(real), 'index.js'))?.id, 'sym')
    // Logical fallback covers --preserve-symlinks style callers.
    assert.strictEqual(index.findByFile(path.join(linked, 'index.js'))?.id, 'sym')
  })

  it('should replace entry on add with same id', () => {
    let base = createFolder()
    let rootA = path.join(base, 'a')
    let rootB = path.join(base, 'b')
    fs.mkdirSync(rootA, { recursive: true })
    fs.mkdirSync(rootB, { recursive: true })
    let index = new ExtensionPathIndex()
    index.add(createModuleDescription('x', rootA, path.join(rootA, 'index.js')))
    assert.strictEqual(index.findByFile(path.join(rootA, 'f.js'))?.id, 'x')
    index.add(createModuleDescription('x', rootB, path.join(rootB, 'index.js')))
    assert.strictEqual(index.findByFile(path.join(rootA, 'f.js')), undefined)
    assert.strictEqual(index.findByFile(path.join(rootB, 'f.js'))?.id, 'x')
  })

  it('should remove extension by id', () => {
    let folder = createFolder()
    let index = new ExtensionPathIndex()
    let desc = createModuleDescription('foo', folder, path.join(folder, 'index.js'))
    index.update([desc])
    assert.strictEqual(index.findByFile(path.join(folder, 'a.js'))?.id, 'foo')
    index.remove('foo')
    assert.strictEqual(index.findByFile(path.join(folder, 'a.js')), undefined)
  })

  it('should record entry and moduleType', () => {
    let folder = createFolder()
    let desc = createModuleDescription('foo', folder, path.join(folder, 'main.js'))
    assert.strictEqual(desc.moduleType, 'commonjs')
    assert.strictEqual(desc.entry, path.join(folder, 'main.js'))
  })
})
