let net = require('net')

let socket = net.createConnection(7658, '127.0.0.1')

socket.on('ready', () => {
  console.log(11)
})

socket.on('timeout', () => {
  console.log('timeout')
})


socket.on('error', e => {
  console.log(e)
})

