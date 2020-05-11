const path = require('path')
const cp = require('child_process')
let res = cp.execSync('git rev-parse HEAD', {encoding: 'utf8'})
let revision = res.slice(0, 10)
let globalDir = cp.execSync('yarn global dir', {encoding: 'utf8'}).trim()
const webpack = require(path.join(globalDir, 'node_modules/webpack'))

module.exports = {
  entry: './bin/server',
  target: 'node',
  mode: 'none',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'index.js'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.REVISION': JSON.stringify(revision)
    })
  ],
  node: {
    __filename: false,
    __dirname: false
  }
}
