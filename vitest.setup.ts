import fs from 'fs'
import os from 'os'
import path from 'path'

(globalThis as any).__TEST__ = true
const dataHome = path.join(os.tmpdir(), 'coc-test' + process.pid.toString())
const tmpdir = path.join(dataHome, 'tmp')
fs.mkdirSync(tmpdir, { recursive: true })
// Redirect runtime sockets to the writable per-process test dir. The LSP pipe
// transport builds its socket path from $XDG_RUNTIME_DIR (falling back to
// os.tmpdir()), so an ambient XDG_RUNTIME_DIR pointing at e.g. ~/.local/share
// makes tests fail in sandboxes where that directory is not writable.
process.env.XDG_RUNTIME_DIR = dataHome
process.env.VIMRUNTIME = ''
process.env.NODE_ENV = 'test'
process.env.COC_NVIM = '1'
process.env.COC_DATA_HOME = dataHome
const vimconfig = path.join(dataHome, 'vimconfig')
fs.mkdirSync(vimconfig, { recursive: true })
process.env.COC_VIMCONFIG = vimconfig

// The setup file runs once per test file in the same worker when isolate is
// disabled, so only register the cleanup listener once per process to avoid
// accumulating exit listeners (MaxListenersExceededWarning).
if (!(process as any).__cocTestCleanupRegistered) {
  (process as any).__cocTestCleanupRegistered = true
  process.on('exit', () => {
    fs.rmSync(dataHome, { recursive: true, force: true })
  })
}
