import fs from 'fs'
import os from 'os'
import path from 'path'

(globalThis as any).__TEST__ = true
let tmpdir = process.env.TMPDIR ?? os.tmpdir()
if (!tmpdir.endsWith('coc-test')) {
  tmpdir = process.env.TMPDIR = path.join(os.tmpdir(), 'coc-test')
}

const dataHome = path.join(tmpdir, process.pid.toString())
fs.mkdirSync(dataHome, { recursive: true })
process.env.VIMRUNTIME = ''
process.env.NODE_ENV = 'test'
process.env.COC_NVIM = '1'
process.env.COC_DATA_HOME = dataHome
process.env.COC_VIMCONFIG = path.join(__dirname, 'src/__tests__')

process.on('exit', () => {
  fs.rmSync(dataHome, { recursive: true, force: true })
})
