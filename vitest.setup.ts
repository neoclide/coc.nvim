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
// Redirect runtime sockets to the writable per-process test dir. The LSP pipe
// transport builds its socket path from $XDG_RUNTIME_DIR (falling back to
// os.tmpdir()), so an ambient XDG_RUNTIME_DIR pointing at e.g. ~/.local/share
// makes tests fail in sandboxes where that directory is not writable.
process.env.XDG_RUNTIME_DIR = dataHome
process.env.VIMRUNTIME = ''
process.env.NODE_ENV = 'test'
process.env.COC_NVIM = '1'
process.env.COC_DATA_HOME = dataHome
process.env.COC_VIMCONFIG = path.join(__dirname, 'src/__tests__')

process.on('exit', () => {
  fs.rmSync(dataHome, { recursive: true, force: true })
})
