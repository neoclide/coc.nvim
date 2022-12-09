const path = require('path')
const os = require('os')
const fs = require('fs')

const tmpdir = process.env.TMPDIR = path.join(os.tmpdir(), 'coc-test')
process.on('uncaughtException', err => {
  let msg = 'Uncaught exception: ' + err.stack
  console.error(msg)
})

process.on('exit', () => {
  fs.rmdirSync(process.env.TMPDIR, {recursive: true, force: true})
})

module.exports = async () => {
  let dataHome = path.join(tmpdir, process.pid.toString())
  fs.mkdirSync(dataHome, {recursive: true})
  process.env.VIMRUNTIME = ''
  process.env.NODE_ENV = 'test'
  process.env.COC_NVIM = '1'
  process.env.COC_DATA_HOME = dataHome
  process.env.COC_VIMCONFIG = path.join(__dirname, 'src/__tests__')
}
