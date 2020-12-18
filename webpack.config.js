const path = require('path')
const cp = require('child_process')
let res = cp.execSync('git rev-parse HEAD', {encoding: 'utf8'})
let revision = res.trim().slice(0, 10)
const webpack = require('webpack')
const dev = process.env.NODE_ENV === 'development'

module.exports = {
  entry: './src/main.ts',
  target: 'node',
  mode: dev ? 'development' : 'none',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'index.js'
  },
  resolve: {
    mainFields: ['module', 'main'],
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    symlinks: false
  },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [{
        loader: 'ts-loader',
        options: {
          transpileOnly: dev,
          experimentalWatchApi: dev,
          compilerOptions: {
            sourceMap: dev,
          }
        }
      }]
    }]
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
