import fs from 'fs'
import os from 'os'
import path from 'path'
import { createExtension } from '../../util/factory'

const Module = require('module')

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-factory-'))
  folders.push(folder)
  return folder
}

afterAll(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

describe('extension sandbox compiler', () => {
  it('should restore module compiler after failed extension load', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, "throw new Error('load failed')")
    let originalCompile = Module.prototype._compile
    expect(() => createExtension('broken', filepath, false)).toThrow('load failed')
    expect(Module.prototype._compile).toBe(originalCompile)
  })

  it('should restore module compiler when dependency fails to load', () => {
    let folder = createFolder()
    let dep = path.join(folder, 'dep.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "throw new Error('dep failed')")
    fs.writeFileSync(filepath, "require('./dep')\nexports.activate = () => {}")
    let originalCompile = Module.prototype._compile
    expect(() => createExtension('broken-dep', filepath, false)).toThrow('dep failed')
    expect(Module.prototype._compile).toBe(originalCompile)
  })

  it('should load plain modules normally after a failed extension load', () => {
    let folder = createFolder()
    let bad = path.join(folder, 'bad.js')
    let good = path.join(folder, 'good.js')
    fs.writeFileSync(bad, "throw new Error('boom')")
    fs.writeFileSync(good, 'module.exports = { ok: true }')
    expect(() => createExtension('bad', bad, false)).toThrow('boom')
    delete require.cache[good]
    expect(require(good)).toEqual({ ok: true })
  })

  it('should load a valid extension after a failed one', () => {
    let folder = createFolder()
    let bad = path.join(folder, 'bad.js')
    let good = path.join(folder, 'good.js')
    fs.writeFileSync(bad, "throw new Error('boom')")
    fs.writeFileSync(good, "exports.activate = () => ({ hello: 'world' })")
    expect(() => createExtension('bad', bad, false)).toThrow('boom')
    let ext = createExtension('good', good, false)
    expect(typeof ext.activate).toBe('function')
    expect(ext.activate({} as any)).toEqual({ hello: 'world' })
  })
})
