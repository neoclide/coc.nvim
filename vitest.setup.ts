import path from 'path'
import os from 'os'
import fs from 'fs'
import Module from 'module'
import { transformSync } from 'esbuild'

const tsExt = '.ts'
if (!(Module as any)._extensions[tsExt]) {
  ;(Module as any)._extensions[tsExt] = function (module: any, filename: string) {
    const cache = (globalThis as any).__esmModuleCache as Map<string, any> | undefined
    if (cache && cache.has(filename)) {
      module.exports = cache.get(filename)
      return
    }
    const source = fs.readFileSync(filename, 'utf8')
    const { code } = transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'node20',
      sourcefile: filename,
    })
    module._compile(code, filename)
  }
}

const tmpdir = process.env.TMPDIR = path.join(os.tmpdir(), 'coc-test')
const dataHome = path.join(tmpdir, process.pid.toString())
fs.mkdirSync(dataHome, { recursive: true })

process.env.VIMRUNTIME = ''
process.env.NODE_ENV = 'test'
process.env.COC_NVIM = '1'
process.env.COC_DATA_HOME = dataHome
process.env.COC_VIMCONFIG = path.join(__dirname, 'src/__tests__')

  ; (globalThis as any).__TEST__ = true

process.on('uncaughtException', err => {
  const msg = 'Uncaught exception: ' + err.stack
  console.error(msg)
})

process.on('exit', () => {
  fs.rmSync(dataHome, { recursive: true, force: true })
})
