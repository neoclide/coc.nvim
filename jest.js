const path = require('path')
const os = require('os')

process.on('uncaughtException', function(err) {
  let msg = 'Uncaught exception: ' + err.stack
  console.error(msg)
})

module.exports = async () => {
  process.env.NODE_ENV = 'test'
  process.env.COC_DATA_HOME = path.join(os.homedir(), '.config/coc')
}
