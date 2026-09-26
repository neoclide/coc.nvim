import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const outputDir = join(scriptDir, '..', 'bin', 'watcher')
const targets = [
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
  'linux-x64-glibc',
  'linux-x64-musl',
  'linux-arm64-glibc',
  'linux-arm64-musl'
]

async function check(directory = outputDir) {
  const expected = new Set(targets.map(target => `${target}.node`))
  const entries = await readdir(directory)
  const stale = entries.filter(name => name.endsWith('.node') && !expected.has(name))
  if (stale.length) throw new Error(`Unexpected watcher binaries: ${stale.join(', ')}`)
  for (const file of expected) {
    const info = await stat(join(directory, file))
    if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty watcher binary: ${file}`)
  }
  const license = await stat(join(directory, 'LICENSE'))
  if (!license.isFile() || license.size === 0) throw new Error('Missing or empty watcher LICENSE')
  console.log(`Verified ${targets.length} native watcher binaries`)
}

async function update() {
  const repository = 'neoclide/native-watcher'
  const runs = JSON.parse(execFileSync('gh', [
    'run', 'list', '--repo', repository, '--workflow', 'test.yml',
    '--branch', 'main', '--status', 'success', '--limit', '1', '--json', 'databaseId,url'
  ], { encoding: 'utf8' }))
  const run = runs[0]
  if (!run) throw new Error('No successful native-watcher CI run found on main')
  console.log(`Downloading watcher binaries from ${run.url}`)
  const sourceDir = await mkdtemp(join(tmpdir(), 'coc-native-watcher-'))
  try {
    execFileSync('gh', [
      'run', 'download', String(run.databaseId), '--repo', repository,
      '--pattern', 'native-watcher-*', '--dir', sourceDir
    ], { stdio: 'inherit' })
    for (const target of targets) {
      const source = join(sourceDir, `native-watcher-${target}`, 'native_watcher.node')
      const info = await stat(source)
      if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty source watcher binary: ${source}`)
    }
    for (const target of targets) {
      const file = `${target}.node`
      await copyFile(join(sourceDir, `native-watcher-${target}`, 'native_watcher.node'), join(outputDir, file))
      console.log(`Updated ${file}`)
    }
    await check()
  } finally {
    await rm(sourceDir, { recursive: true, force: true })
  }
}

if (process.argv[2] === '--check') {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/update-watcher-binaries.mjs --check')
  await check()
} else {
  if (process.argv.length !== 2) {
    throw new Error('Usage: npm run update:watcher-binaries')
  }
  await update()
}
