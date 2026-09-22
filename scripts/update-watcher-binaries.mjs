import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { x as extract } from 'tar'

const version = '2.6.0'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const outputDir = join(scriptDir, '..', 'bin', 'watcher')
const targets = [
  ['darwin-x64', '@parcel/watcher-darwin-x64'],
  ['darwin-arm64', '@parcel/watcher-darwin-arm64'],
  ['win32-x64', '@parcel/watcher-win32-x64'],
  ['win32-arm64', '@parcel/watcher-win32-arm64'],
  ['linux-x64-glibc', '@parcel/watcher-linux-x64-glibc'],
  ['linux-x64-musl', '@parcel/watcher-linux-x64-musl'],
  ['linux-arm64-glibc', '@parcel/watcher-linux-arm64-glibc'],
  ['linux-arm64-musl', '@parcel/watcher-linux-arm64-musl'],
  ['linux-arm-glibc', '@parcel/watcher-linux-arm-glibc'],
  ['linux-arm-musl', '@parcel/watcher-linux-arm-musl'],
  ['freebsd-x64', '@parcel/watcher-freebsd-x64']
]

function digest(algorithm, data, encoding = 'hex') {
  return createHash(algorithm).update(data).digest(encoding)
}

async function fetchWithRetry(url, read) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return await read(response)
      lastError = new Error(`Request failed with status ${response.status}: ${url}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function check(directory = outputDir) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.version !== version) throw new Error(`Expected Parcel watcher ${version}, found ${manifest.version}`)
  const expected = new Set(targets.map(([target]) => `${target}.node`))
  if (manifest.binaries.length !== expected.size) throw new Error('Unexpected Parcel watcher binary count')
  for (const entry of manifest.binaries) {
    if (!expected.delete(entry.file)) throw new Error(`Unexpected Parcel watcher binary: ${entry.file}`)
    const data = await readFile(join(directory, entry.file))
    if (digest('sha256', data) !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.file}`)
  }
  if (expected.size) throw new Error(`Missing Parcel watcher binaries: ${Array.from(expected).join(', ')}`)
  await readFile(join(directory, 'LICENSE'))
  console.log(`Verified ${manifest.binaries.length} Parcel watcher ${version} binaries`)
}

async function update() {
  await mkdir(dirname(outputDir), { recursive: true })
  const tempDir = await mkdtemp(join(tmpdir(), 'coc-parcel-watcher-'))
  const stageDir = await mkdtemp(join(dirname(outputDir), '.watcher-update-'))
  const backupDir = `${stageDir}-previous`
  const binaries = []
  try {
    for (const [target, packageName] of targets) {
      const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`
      const metadata = await fetchWithRetry(metadataUrl, response => response.json())
      const archive = Buffer.from(await fetchWithRetry(metadata.dist.tarball, response => response.arrayBuffer()))
      const [algorithm, expectedIntegrity] = metadata.dist.integrity.split('-', 2)
      const actualIntegrity = digest(algorithm, archive, 'base64')
      if (actualIntegrity !== expectedIntegrity) throw new Error(`Integrity mismatch for ${packageName}`)

      const packageDir = join(tempDir, 'package')
      await rm(packageDir, { recursive: true, force: true })
      const archivePath = join(tempDir, `${target}.tgz`)
      await writeFile(archivePath, archive)
      await extract({ cwd: tempDir, file: archivePath })
      const source = join(packageDir, 'watcher.node')
      const data = await readFile(source)
      const file = `${target}.node`
      await writeFile(join(stageDir, file), data)
      if (binaries.length === 0) await copyFile(join(packageDir, 'LICENSE'), join(stageDir, 'LICENSE'))
      binaries.push({
        file,
        package: packageName,
        integrity: metadata.dist.integrity,
        sha256: digest('sha256', data)
      })
      console.log(`Updated ${file}`)
    }
    await writeFile(join(stageDir, 'manifest.json'), `${JSON.stringify({ version, binaries }, null, 2)}\n`)
    await check(stageDir)

    let hasPrevious = false
    try {
      await rename(outputDir, backupDir)
      hasPrevious = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    try {
      await rename(stageDir, outputDir)
    } catch (error) {
      if (hasPrevious) await rename(backupDir, outputDir)
      throw error
    }
    if (hasPrevious) await rm(backupDir, { recursive: true, force: true })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
    await rm(stageDir, { recursive: true, force: true })
  }
  await check()
}

if (process.argv.includes('--check')) {
  await check()
} else {
  await update()
}
