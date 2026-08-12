import { findUp, isDirectory, findMatch, watchFile, writeJson, loadJson, normalizeFilePath, checkFolder, getFileType, isGitIgnored, readFileLine, readFileLines, fileStartsWith, writeFile, remove, renameAsync, isParentFolder, parentDirs, inDirectory, getFileLineCount, sameFile, lineToLocation, resolveRoot, statAsync, uriToFsPath, FileType } from '../../util/fs'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { CancellationToken, CancellationTokenSource, Range } from 'vscode-languageserver-protocol'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

async function waitValue(fn: () => number, value: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await wait(20)
    if (fn() >= value) return
  }
  throw new Error(`waitValue ${value} timeout`)
}

describe('fs', () => {
  describe('uriToFsPath()', () => {
    it('should keep POSIX single-letter-colon paths absolute (#2974)', () => {
      // vscode-uri treats /F: as a Windows drive and drops the leading slash
      assert.strictEqual(uriToFsPath('file:///F:'), '/F:')
      assert.strictEqual(uriToFsPath('file:///F:/x'), '/F:/x')
      assert.strictEqual(uriToFsPath('file:///f%3A/x'), '/f:/x')
      // unaffected shapes keep the normal behavior
      assert.strictEqual(uriToFsPath('file:///FF:'), '/FF:')
      assert.strictEqual(uriToFsPath('file:///home/user/F:'), '/home/user/F:')
      assert.strictEqual(uriToFsPath('file:///tmp/foo'), '/tmp/foo')
    })
  })

  describe('normalizeFilePath()', () => {
    it('should fs normalizeFilePath', () => {
      let res = normalizeFilePath('//')
      assert.strictEqual(res, '/')
      res = normalizeFilePath('/a/b/')
      assert.strictEqual(res, '/a/b')
    })
  })

  it('should check directory', () => {
    assert.strictEqual(isDirectory(null), false)
    assert.strictEqual(isDirectory(''), false)
    assert.strictEqual(isDirectory(import.meta.filename), false)
    assert.strictEqual(isDirectory(process.cwd()), true)
  })

  it('should watch file', async () => {
    let filepath = path.join(os.tmpdir(), crypto.randomUUID())
    fs.writeFileSync(filepath, 'file', 'utf8')
    let resolveChange: () => void
    let changed = new Promise<void>(resolve => {
      resolveChange = resolve
    })
    let disposable = watchFile(filepath, () => {
      resolveChange()
    }, true)
    await changed
    // Replace the file by rename like an atomic save: the watcher must
    // survive the inode replacement and keep reporting changes.
    changed = new Promise<void>(resolve => {
      resolveChange = resolve
    })
    let tmp = `${filepath}.tmp`
    fs.writeFileSync(tmp, 'new file', 'utf8')
    fs.renameSync(tmp, filepath)
    await changed
    disposable.dispose()
    disposable = watchFile('file_not_exists', () => {}, true)
    disposable.dispose()
  })

  it('should keep watching after file is deleted and recreated', async () => {
    let filepath = path.join(os.tmpdir(), crypto.randomUUID())
    fs.writeFileSync(filepath, 'file', 'utf8')
    let called = 0
    let disposable = watchFile(filepath, () => {
      called++
    })
    await wait(50)
    fs.rmSync(filepath)
    await waitValue(() => called, 1)
    fs.writeFileSync(filepath, 'new file', 'utf8')
    await waitValue(() => called, 2)
    disposable.dispose()
  })

  it('should call onError when parent directory not exists', () => {
    let dir = path.join(os.tmpdir(), crypto.randomUUID())
    let error: Error | undefined
    let disposable = watchFile(path.join(dir, 'foo.json'), () => {}, false, e => {
      error = e
    })
    assert.notStrictEqual(error, undefined)
    disposable.dispose()
  })

  describe('stat()', () => {
    it('fs statAsync', async () => {
      let res = await statAsync(import.meta.filename)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.isFile(), true)
    })

    it('fs statAsync #1', async () => {
      let res = await statAsync(path.join(import.meta.dirname, 'file_not_exist'))
      assert.strictEqual(res, null)
    })
  })

  describe('loadJson()', () => {
    it('should loadJson()', () => {
      let file = path.join(import.meta.dirname, 'not_exists.json')
      assert.deepStrictEqual(loadJson(file), {})
    })

    it('should loadJson with bad format', async () => {
      let file = path.join(os.tmpdir(), crypto.randomUUID())
      fs.writeFileSync(file, 'foo', 'utf8')
      assert.deepStrictEqual(loadJson(file), {})
    })
  })

  describe('writeJson()', () => {
    it('should writeJson file', async () => {
      let file = path.join(os.tmpdir(), crypto.randomUUID())
      writeJson(file, { x: 1 })
      assert.deepStrictEqual(loadJson(file), { x: 1 })
    })

    it('should create file with folder', async () => {
      let file = path.join(os.tmpdir(), crypto.randomUUID(), 'foo', 'bar')
      writeJson(file, { foo: '1' })
      assert.deepStrictEqual(loadJson(file), { foo: '1' })
    })
  })

  describe('lineToLocation', () => {
    it('should not throw when file not exists', async () => {
      let res = await lineToLocation(path.join(os.tmpdir(), 'not_exists'), 'ab')
      assert.notStrictEqual(res, undefined)
    })

    it('should use empty range when not found', async () => {
      let res = await lineToLocation(import.meta.filename, 'a'.repeat(100))
      assert.notStrictEqual(res, undefined)
      assert.deepStrictEqual(res.range, Range.create(0, 0, 0, 0))
    })

    it('should get location', async () => {
      let file = path.join(os.tmpdir(), crypto.randomUUID())
      fs.writeFileSync(file, '\nfoo\n', 'utf8')
      let res = await lineToLocation(file, 'foo', 'foo')
      assert.deepStrictEqual(res.range, Range.create(1, 0, 1, 3))
    })
  })

  describe('remove()', () => {
    it('should remove files', async () => {
      await remove(path.join(os.tmpdir(), crypto.randomUUID()))
      let p = path.join(os.tmpdir(), crypto.randomUUID())
      fs.writeFileSync(p, 'data', 'utf8')
      await remove(p)
      let exists = fs.existsSync(p)
      assert.strictEqual(exists, false)
      await remove(undefined)
    })

    it('should not throw error', async t => {
      t.mock.method(fs, 'rm', () => {
        throw new Error('my error')
      })
      let p = path.join(os.tmpdir(), crypto.randomUUID())
      await remove(p)
    })

    it('should remove folder', async () => {
      let f = path.join(os.tmpdir(), crypto.randomUUID())
      let p = path.join(f, 'a/b/c')
      fs.mkdirSync(p, { recursive: true })
      await remove(f)
      let exists = fs.existsSync(f)
      assert.strictEqual(exists, false)
    })
  })

  describe('getFileType()', () => {
    it('should get filetype', async t => {
      let res = await getFileType(import.meta.dirname)
      assert.strictEqual(res, FileType.Directory)
      res = await getFileType(import.meta.filename)
      assert.strictEqual(res, FileType.File)
      let newPath = path.join(os.tmpdir(), crypto.randomUUID())
      fs.symlinkSync(import.meta.filename, newPath)
      res = await getFileType(newPath)
      assert.strictEqual(res, FileType.SymbolicLink)
      fs.unlinkSync(newPath)
      t.mock.method(fs.promises, 'lstat', async () => ({
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => false
      }) as any)
      res = await getFileType('__file')
      assert.strictEqual(res, FileType.Unknown)
    })
  })

  describe('checkFolder()', () => {
    it('should check file in folder', async () => {
      let cwd = process.cwd()
      let res = await checkFolder(cwd, ['package.json'])
      assert.strictEqual(res, true)
      res = await checkFolder(cwd, ['**/schema.json', 'package.json'])
      assert.strictEqual(res, true)
      res = await checkFolder(cwd, [])
      assert.strictEqual(res, false)
      res = await checkFolder(cwd, ['not_exists_fs'], CancellationToken.None)
      assert.strictEqual(res, false)
      res = await checkFolder(os.homedir(), ['not_exists_fs'])
      assert.strictEqual(res, false)
      res = await checkFolder('/a/b/c', ['not_exists_fs'])
      assert.strictEqual(res, false)
      let tokenSource = new CancellationTokenSource()
      let p = checkFolder(cwd, ['**/a.java'], tokenSource.token)
      let fn = async () => {
        tokenSource.cancel()
        res = await p
      }
      await assert.rejects(fn(), Error)
      assert.strictEqual(res, false)
    })
  })

  describe('renameAsync()', () => {
    it('should rename file', async () => {
      let id = crypto.randomUUID()
      let filepath = path.join(os.tmpdir(), id)
      await writeFile(filepath, id)
      let dest = path.join(os.tmpdir(), 'bar')
      await renameAsync(filepath, dest)
      let exists = fs.existsSync(dest)
      assert.strictEqual(exists, true)
      fs.unlinkSync(dest)
    })

    it('should throw when file does not exist', async () => {
      let err
      try {
        await renameAsync('/foo/bar', '/a')
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })
  })

  describe('getFileLineCount', () => {
    it('should throw when file does not exist', async () => {
      let err
      try {
        await getFileLineCount('/foo/bar')
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })
  })

  describe('sameFile', () => {
    it('should be casesensitive', () => {
      assert.strictEqual(sameFile('/a', '/A', false), false)
      assert.strictEqual(sameFile('/a', '/A', true), true)
    })
  })

  describe('readFileLine', () => {
    it('should read line', async () => {
      let res = await readFileLine(import.meta.filename, 1)
      assert.notStrictEqual(res, undefined)
      res = await readFileLine(import.meta.filename, 9999)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res, '')
    })

    it('should throw when file does not exist', async () => {
      const fn = async () => {
        await readFileLine(import.meta.filename + 'fooobar', 1)
      }
      await assert.rejects(fn(), Error)
    })
  })

  describe('readFileLines', () => {
    it('should throw when file does not exist', async () => {
      const fn = async () => {
        await readFileLines(import.meta.filename + 'fooobar', 0, 3)
      }
      await assert.rejects(fn(), Error)
    })

    it('should read lines', async () => {
      let res = await readFileLines(import.meta.filename, 0, 1)
      assert.strictEqual(res.length, 2)
    })
  })

  describe('fileStartsWith()', () => {
    it('should check casesensitive case', () => {
      assert.strictEqual(fileStartsWith('/a/b', '/A', false), false)
      assert.strictEqual(fileStartsWith('/a/b', '/A', true), true)
    })
  })

  describe('isGitIgnored()', () => {
    it('should be not ignored', async () => {
      let res = await isGitIgnored(path.join(process.cwd(), 'src/__tests__/unit/fs.test.ts'))
      assert.ok(!res)
      let filepath = path.join(process.cwd(), 'build/index.js')
      res = await isGitIgnored(filepath)
      assert.strictEqual(res, true)
    })

    it('should be ignored', async () => {
      let res = await isGitIgnored('')
      let uid = crypto.randomUUID()
      assert.strictEqual(res, false)
      res = await isGitIgnored(path.join(os.tmpdir(), uid))
      assert.strictEqual(res, false)
      res = await isGitIgnored(path.resolve(import.meta.dirname, '../lib/index.js.map'))
      assert.strictEqual(res, false)
      res = await isGitIgnored(path.join(process.cwd(), 'src/__tests__/unit/fs.test.ts'))
      assert.strictEqual(res, false)
      let filepath = path.join(os.tmpdir(), uid)
      fs.writeFileSync(filepath, '', { encoding: 'utf8' })
      res = await isGitIgnored(filepath)
      assert.strictEqual(res, false)
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    })

    it('should not execute shell commands from file name', async () => {
      let dir = path.join(fs.realpathSync(os.tmpdir()), crypto.randomUUID())
      fs.mkdirSync(dir)
      try {
        await promisify(execFile)('git', ['init'], { cwd: dir })
        let marker = path.join(dir, 'pwned')
        let file = path.join(dir, 'evil; touch pwned')
        fs.writeFileSync(file, '')
        fs.writeFileSync(path.join(dir, '.gitignore'), 'evil*\n', 'utf8')
        let res = await isGitIgnored(file)
        assert.strictEqual(res, true)
        assert.strictEqual(fs.existsSync(marker), false)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('inDirectory', () => {
    it('should support wildcard', async () => {
      let res = inDirectory(import.meta.dirname, ['**/file_not_exist.json'])
      assert.strictEqual(res, false)
    })
  })

  describe('parentDirs', () => {
    it('get parentDirs', () => {
      let dirs = parentDirs('/a/b/c')
      assert.deepStrictEqual(dirs, ['/', '/a', '/a/b'])
      assert.deepStrictEqual(parentDirs('/'), ['/'])
    })
  })

  describe('isParentFolder', () => {
    it('check parent folder', () => {
      assert.strictEqual(isParentFolder('/a/b', '/a/b/'), false)
      assert.strictEqual(isParentFolder('/a', '/a/b'), true)
      assert.strictEqual(isParentFolder('/a/b', '/a/b'), false)
      assert.strictEqual(isParentFolder('/a/b', '/a/b', true), true)
      assert.strictEqual(isParentFolder('//', '/', true), true)
      assert.strictEqual(isParentFolder('/a/b/', '/a/b/c', true), true)
    })
  })

  describe('resolveRoot', () => {
    it('resolve root consider root path', () => {
      // The compiled build tree lives in the OS temp dir since the
      // 2026-08-11 runner refactor; anchor upward traversal at the repo root
      // (process.cwd()) instead of import.meta.dirname so it is location-independent.
      let res = resolveRoot(process.cwd(), ['.git'])
      assert.match(res, new RegExp('coc.nvim'))
    })

    it('should ignore glob pattern', () => {
      let res = resolveRoot(import.meta.dirname, [path.basename(import.meta.filename)], undefined, false, false, ["**/__tests__/**"])
      assert.ok(!res)
    })

    it('should ignore glob pattern bottom up', () => {
      let res = resolveRoot(import.meta.dirname, [path.basename(import.meta.filename)], undefined, true, false, ["**/__tests__/**"])
      assert.ok(!res)
    })

    it('should resolve from parent folders', () => {
      let root = path.resolve(process.cwd(), 'src/__tests__/extensions/snippet-sample')
      let res = resolveRoot(root, ['package.json'])
      assert.strictEqual(res.endsWith('coc.nvim'), true)
    })

    it('should resolve from parent folders with bottom-up method', () => {
      let dir = path.join(os.tmpdir(), 'extensions/snippet-sample')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.resolve(dir, '../package.json'), '{}')
      let res = resolveRoot(dir, ['package.json'], null, true)
      assert.strictEqual(res.endsWith('extensions'), true)
      fs.rmSync(path.dirname(dir), { recursive: true, force: true })
    })

    it('should resolve to cwd', () => {
      let root = path.resolve(import.meta.dirname, '../../..')
      let res = resolveRoot(root, ['package.json'], root, false, true)
      assert.strictEqual(res, root)
    })

    it('should resolve to root', () => {
      let root = path.join(process.cwd(), 'src/__tests__/extensions/test/')
      let res = resolveRoot(root, ['package.json'], root, false, false)
      assert.strictEqual(res, process.cwd())
    })

    it('should not resolve to home', () => {
      let res = resolveRoot(import.meta.dirname, ['.config'], undefined, false, false, [os.homedir()])
      assert.ok(res != os.homedir())
    })
  })

  describe('findUp', () => {
    it('should findMatch by pattern', async () => {
      let res = findMatch(process.cwd(), ['*.json'])
      assert.match(res, new RegExp('.json'))
      res = findMatch(process.cwd(), ['*.json_not_exists'])
      assert.strictEqual(res, undefined)
    })

    it('findUp by filename', () => {
      let filepath = findUp('package.json', process.cwd())
      assert.match(filepath, new RegExp('coc.nvim'))
      filepath = findUp('not_exists', process.cwd())
      assert.strictEqual(filepath, null)
    })

    it('findUp by filenames', async () => {
      let filepath = findUp(['src'], process.cwd())
      assert.match(filepath, new RegExp('coc.nvim'))
    })
  })
})
