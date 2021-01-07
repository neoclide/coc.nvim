const cp = require('child_process')
const fs = require('fs')
const path = require('path')
let revision = ''
try {
  let res = cp.execSync('git rev-parse HEAD', {encoding: 'utf8'})
  revision = res.trim().slice(0, 10)
} catch (e) {
  // ignore
}

let entryPlugin = {
  name: 'entry',
  setup(build) {
    build.onResolve({filter: /^index.ts$/}, args => {
      return {
        path: args.path,
        namespace: 'entry-ns'
      }
    })
    build.onLoad({filter: /.*/, namespace: 'entry-ns'}, () => {
      let contents = `
let version = process.version.replace('v', '')
let parts = version.split('.')
function greatThanOrEqual(nums, major, minor) {
  if (nums[0] > major) return true
  if (nums[0] == major && nums[1] >= minor) return true
  return false
}
let numbers = parts.map(function (s) {
  return parseInt(s, 10)
})
if (!greatThanOrEqual(numbers, 10, 12)) {
  console.error('node version ' + version + ' < 8.10.0, please upgrade nodejs, or use \`let g:coc_node_path = "/path/to/node"\` in your vimrc')
  process.exit()
}
      require('./src/main')
      `
      return {
        contents,
        resolveDir: __dirname
      }
    })
  }
}

// replace require.main with empty string
let envPlugin = {
  name: 'env',
  setup(build) {
    build.onResolve({filter: /\/appenders/}, args => {
      let fullpath = path.join(args.resolveDir, args.path)
      return {
        path: path.relative(__dirname, fullpath),
        namespace: 'env-ns'
      }
    })
    build.onLoad({filter: /^node_modules\/log4js\/lib\/appenders$/, namespace: 'env-ns'}, args => {
      let content = fs.readFileSync(path.join(args.path, 'index.js'), 'utf8')
      return {
        contents: content.replace(/require\.main/g, '""'),
        resolveDir: args.path
      }
    })
  }
}

async function start() {
  await require('esbuild').build({
    entryPoints: ['index.ts'],
    bundle: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV === 'development',
    define: {REVISION: '"' + revision + '"', ESBUILD: 'true'},
    mainFields: ['module', 'main'],
    platform: 'node',
    target: 'node10.12',
    outfile: 'build/index.js',
    plugins: [entryPlugin, envPlugin]
  })
}

start().catch(e => {
  console.error(e)
})
