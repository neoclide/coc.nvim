const path = require('path')

module.exports = {
  entry: './bin/server',
  target: 'node',
  mode: 'none',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'index.js'
  },
  plugins: [
  ],
  node: {
    __filename: false,
    __dirname: false
  }
}
