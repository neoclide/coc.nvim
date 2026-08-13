import fs from 'fs'
import os from 'os'
import path from 'path'
import { createExtension } from '../../util/factory'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-factory-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

describe('extension sandbox compiler', () => {
  it('should restore module compiler after failed extension load', t => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, "throw new Error('load failed')")
    assert.throws(() => createExtension('broken', filepath, false), new RegExp('load failed'))
  })

  it('should restore module compiler when dependency fails to load', t => {
    let folder = createFolder()
    let dep = path.join(folder, 'dep.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "throw new Error('dep failed')")
    fs.writeFileSync(filepath, "require('./dep')\nexports.activate = () => {}")
    assert.throws(() => createExtension('broken-dep', filepath, false), new RegExp('dep failed'))
  })

  it('should load plain modules normally after a failed extension load', t => {
    let folder = createFolder()
    let bad = path.join(folder, 'bad.js')
    let good = path.join(folder, 'good.js')
    fs.writeFileSync(bad, "throw new Error('boom')")
    fs.writeFileSync(good, 'module.exports = { ok: true }')
    assert.throws(() => createExtension('bad', bad, false), new RegExp('boom'))
  })

  it('should load a valid extension after a failed one', t => {
    let folder = createFolder()
    let bad = path.join(folder, 'bad.js')
    let good = path.join(folder, 'good.js')
    fs.writeFileSync(bad, "throw new Error('boom')")
    fs.writeFileSync(good, "exports.activate = () => ({ hello: 'world' })")
    assert.throws(() => createExtension('bad', bad, false), new RegExp('boom'))
    let ext = createExtension('good', good, false)
    assert.strictEqual(typeof ext.activate, 'function')
    // activate() runs inside the VM sandbox; spread into a plain object so
    // deepStrictEqual does not compare the cross-realm prototype.
    assert.deepStrictEqual({ ...ext.activate({} as any) }, { hello: 'world' })
  })

  it('should reload dependency state on extension reload', t => {
    let folder = createFolder()
    let depDir = path.join(folder, 'node_modules', 'dep')
    fs.mkdirSync(depDir, { recursive: true })
    let dep = path.join(depDir, 'index.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "module.exports = { value: 'one' }")
    fs.writeFileSync(filepath, "let dep = require('dep')\nexports.activate = () => dep.value")
    let ext1 = createExtension('reload-dep', filepath, false)
    assert.strictEqual(ext1.activate({} as any), 'one')
    // simulate dependency update followed by reloadExtension
    fs.writeFileSync(dep, "module.exports = { value: 'two' }")
    let ext2 = createExtension('reload-dep', filepath, false)
    assert.strictEqual(ext2.activate({} as any), 'two')
  })

  it('should not share singleton dependency state between reloads', t => {
    let folder = createFolder()
    let dep = path.join(folder, 'dep.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "let count = 0\nmodule.exports = { inc: () => ++count, get count() { return count } }")
    fs.writeFileSync(filepath, "let dep = require('./dep')\nexports.activate = () => ({ inc: dep.inc })")
    let ext1 = createExtension('reload-state', filepath, false)
    let api1 = ext1.activate({} as any)
    assert.strictEqual(api1.inc(), 1)
    let ext2 = createExtension('reload-state', filepath, false)
    let api2 = ext2.activate({} as any)
    assert.strictEqual(api2.inc(), 1)
  })
})
