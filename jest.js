
process.on('uncaughtException', function(err) {
  let msg = 'Uncaught exception: ' + err.stack
  console.error(msg)
})

module.exports = async () => {
  process.env.NODE_ENV = 'test'
}
