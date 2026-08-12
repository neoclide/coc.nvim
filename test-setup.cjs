'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const nodeTest = require('node:test')
const { transformSync } = require('esbuild')

const root = __dirname
const tsconfigRaw = fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')

require.extensions['.ts'] = function(module, filename) {
  const result = transformSync(fs.readFileSync(filename, 'utf8'), {
    format: 'cjs',
    loader: 'ts',
    platform: 'node',
    sourcefile: filename,
    sourcemap: 'inline',
    supported: { 'dynamic-import': false },
    target: 'node20',
    tsconfigRaw,
  })
  module._compile(result.code, filename)
}

globalThis.afterAll = nodeTest.after
globalThis.afterEach = nodeTest.afterEach
globalThis.assert = assert
globalThis.beforeAll = nodeTest.before
globalThis.beforeEach = nodeTest.beforeEach
globalThis.describe = nodeTest.describe
globalThis.it = nodeTest.it
globalThis.test = nodeTest.test

globalThis.__TEST__ = true
const dataHome = path.join(os.tmpdir(), 'coc-test' + process.pid.toString())
const tmpdir = path.join(dataHome, 'tmp')
fs.mkdirSync(tmpdir, { recursive: true })
process.env.XDG_RUNTIME_DIR = dataHome
process.env.VIMRUNTIME = ''
process.env.NODE_ENV = 'test'
process.env.COC_NVIM = '1'
process.env.COC_DATA_HOME = dataHome
process.env.NVIM_LOG_FILE = path.join(dataHome, 'nvim.log')
process.env.COC_MCP_DIR = path.join(dataHome, 'mcp')
const vimconfig = path.join(dataHome, 'vimconfig')
fs.mkdirSync(vimconfig, { recursive: true })
process.env.COC_VIMCONFIG = vimconfig

process.on('exit', () => {
  fs.rmSync(dataHome, { recursive: true, force: true })
})
