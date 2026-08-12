'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = __dirname
const testsRoot = path.join(root, 'src', '__tests__')

function findTests(directory) {
  let files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filepath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...findTests(filepath))
    if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(filepath)
  }
  return files
}

function resolveTests(args) {
  if (args.length === 0) return findTests(testsRoot)
  let files = []
  for (const arg of args) {
    const filepath = path.resolve(root, arg)
    const stat = fs.statSync(filepath)
    files.push(...(stat.isDirectory() ? findTests(filepath) : [filepath]))
  }
  return files
}

const passthrough = []
const requested = []
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--test-')) passthrough.push(arg)
  else requested.push(arg)
}

const vimTest = path.join(testsRoot, 'vim.test.ts')
const files = resolveTests(requested)
  .sort()
  .map(filepath => filepath === vimTest ? path.join(root, 'test-vim.cjs') : filepath)

const args = [
  '--enable-source-maps',
  '--require',
  path.join(root, 'test-setup.cjs'),
  '--test',
  '--test-reporter=spec',
  ...passthrough,
]
if (process.env.TEST_CONCURRENCY && !passthrough.some(arg => arg.startsWith('--test-concurrency'))) {
  args.push(`--test-concurrency=${process.env.TEST_CONCURRENCY}`)
}
args.push(...files)

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
