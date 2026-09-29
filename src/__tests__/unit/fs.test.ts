import { findUp, isDirectory, findMatch, watchFile, writeJson, loadJson, normalizeFilePath, checkFolder, getFileType, isGitIgnored, readFileLine, readFileLines, fileStartsWith, writeFile, remove, renameSync, isParentFolder, parentDirs, inDirectory, getFileLineCount, sameFile, lineToLocation, resolveRoot, statAsync, uriToFsPath, FileType } from '../../util/fs'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { CancellationToken, CancellationTokenSource, Range } from 'vscode-languageserver-protocol'

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
  describe('renameSync()', () => {
    it('should rename without copying when possible', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'content')
      let copy = t.mock.method(fs, 'cpSync')
      try {
        renameSync(source, target)
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'content')
        assert.strictEqual(copy.mock.calls.length, 0)
      } finally {
        copy.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should rethrow rename errors other than EXDEV', t => {
      let source = path.join(os.tmpdir(), crypto.randomUUID())
      let target = path.join(os.tmpdir(), crypto.randomUUID())
      let error = Object.assign(new Error('denied'), { code: 'EACCES' })
      let rename = t.mock.method(fs, 'renameSync', () => {
        throw error
      })
      let copy = t.mock.method(fs, 'cpSync')
      try {
        assert.throws(() => renameSync(source, target), e => e === error)
        assert.strictEqual(copy.mock.calls.length, 0)
      } finally {
        rename.mock.restore()
        copy.mock.restore()
      }
    })

    it('should copy files and directories on EXDEV', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let sourceFile = path.join(root, 'source-file')
      let sourceDirectory = path.join(root, 'source-directory')
      let targetFile = path.join(root, 'target-file')
      let targetDirectory = path.join(root, 'target-directory')
      fs.writeFileSync(sourceFile, 'file', { mode: 0o640 })
      fs.utimesSync(sourceFile, 1700000000, 1700000000)
      let originalStat = fs.statSync(sourceFile)
      fs.mkdirSync(sourceDirectory)
      fs.writeFileSync(path.join(sourceDirectory, 'child'), 'child')
      let originalRenameSync = fs.renameSync.bind(fs)
      let rename = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        if ([sourceFile, sourceDirectory, targetFile, targetDirectory].includes(oldPath)) {
          throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
        }
        originalRenameSync(oldPath, newPath)
      })
      try {
        renameSync(sourceFile, targetFile)
        renameSync(sourceDirectory, targetDirectory)
        assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'file')
        assert.strictEqual(fs.statSync(targetFile).mtimeMs, originalStat.mtimeMs)
        if (process.platform !== 'win32') assert.strictEqual(fs.statSync(targetFile).mode & 0o777, originalStat.mode & 0o777)
        assert.strictEqual(fs.readFileSync(path.join(targetDirectory, 'child'), 'utf8'), 'child')
        assert.strictEqual(fs.existsSync(sourceFile), false)
        assert.strictEqual(fs.existsSync(sourceDirectory), false)
        renameSync(targetFile, sourceFile)
        renameSync(targetDirectory, sourceDirectory)
        assert.strictEqual(fs.readFileSync(sourceFile, 'utf8'), 'file')
        assert.strictEqual(fs.readFileSync(path.join(sourceDirectory, 'child'), 'utf8'), 'child')
        assert.strictEqual(fs.readdirSync(root).some(name => name.startsWith('target-')), false)
      } finally {
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should copy top-level and nested symbolic links on EXDEV', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      let reference = path.join(root, 'reference')
      let referenceDirectory = path.join(root, 'reference-directory')
      let sourceFileLink = path.join(root, 'source-file-link')
      let targetFileLink = path.join(root, 'target-file-link')
      let sourceDirectoryLink = path.join(root, 'source-directory-link')
      let targetDirectoryLink = path.join(root, 'target-directory-link')
      fs.mkdirSync(source)
      fs.writeFileSync(reference, 'reference')
      fs.mkdirSync(referenceDirectory)
      fs.writeFileSync(path.join(referenceDirectory, 'child'), 'directory content')
      try {
        fs.symlinkSync('missing', path.join(source, 'dangling-link'), process.platform === 'win32' ? 'file' : undefined)
        fs.symlinkSync('../reference', path.join(source, 'relative-link'), process.platform === 'win32' ? 'file' : undefined)
        fs.symlinkSync('missing', path.join(root, 'source-link'), process.platform === 'win32' ? 'file' : undefined)
        fs.symlinkSync('reference', sourceFileLink, process.platform === 'win32' ? 'file' : undefined)
        fs.symlinkSync('reference-directory', sourceDirectoryLink, process.platform === 'win32' ? 'dir' : undefined)
      } catch (_e) {
        fs.rmSync(root, { force: true, recursive: true })
        return t.skip('symbolic links unavailable')
      }
      let sourceLink = path.join(root, 'source-link')
      let targetLink = path.join(root, 'target-link')
      let originalRenameSync = fs.renameSync.bind(fs)
      let rename = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        if ([source, target, sourceLink, targetLink, sourceFileLink, targetFileLink, sourceDirectoryLink, targetDirectoryLink].includes(oldPath)) {
          throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
        }
        originalRenameSync(oldPath, newPath)
      })
      try {
        renameSync(source, target)
        renameSync(sourceLink, targetLink)
        renameSync(sourceFileLink, targetFileLink)
        renameSync(sourceDirectoryLink, targetDirectoryLink)
        for (let [filepath, text] of [
          [path.join(target, 'relative-link'), path.join('..', 'reference')],
          [path.join(target, 'dangling-link'), 'missing'],
          [targetLink, 'missing'],
          [targetFileLink, 'reference'],
          [targetDirectoryLink, 'reference-directory']
        ]) {
          assert.strictEqual(fs.lstatSync(filepath).isSymbolicLink(), true)
          assert.strictEqual(fs.readlinkSync(filepath), text)
        }
        assert.strictEqual(fs.readFileSync(reference, 'utf8'), 'reference')
        assert.strictEqual(fs.readFileSync(path.join(referenceDirectory, 'child'), 'utf8'), 'directory content')
        renameSync(target, source)
        renameSync(targetLink, sourceLink)
        renameSync(targetFileLink, sourceFileLink)
        renameSync(targetDirectoryLink, sourceDirectoryLink)
        for (let [filepath, text] of [
          [path.join(source, 'relative-link'), path.join('..', 'reference')],
          [path.join(source, 'dangling-link'), 'missing'],
          [sourceLink, 'missing'],
          [sourceFileLink, 'reference'],
          [sourceDirectoryLink, 'reference-directory']
        ]) {
          assert.strictEqual(fs.lstatSync(filepath).isSymbolicLink(), true)
          assert.strictEqual(fs.readlinkSync(filepath), text)
        }
        assert.strictEqual(fs.readFileSync(reference, 'utf8'), 'reference')
        assert.strictEqual(fs.readFileSync(path.join(referenceDirectory, 'child'), 'utf8'), 'directory content')
      } finally {
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should remove partial targets when copying fails', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'source')
      let rename = t.mock.method(fs, 'renameSync', () => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      })
      let copy = t.mock.method(fs, 'cpSync', (oldPath, newPath) => {
        fs.writeFileSync(newPath, 'partial')
        throw Object.assign(new Error('copy failed'), { code: 'EIO' })
      })
      try {
        assert.throws(() => renameSync(source, target), { code: 'EIO' })
        assert.strictEqual(fs.readFileSync(source, 'utf8'), 'source')
        assert.strictEqual(fs.existsSync(target), false)
      } finally {
        copy.mock.restore()
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should retain a partial target when copy cleanup fails', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'source')
      let rename = t.mock.method(fs, 'renameSync', () => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      })
      let copy = t.mock.method(fs, 'cpSync', (oldPath, newPath) => {
        fs.writeFileSync(newPath, 'partial')
        throw Object.assign(new Error('copy failed'), { code: 'EIO' })
      })
      let originalRmSync = fs.rmSync.bind(fs)
      let remove = t.mock.method(fs, 'rmSync', (filepath, options) => {
        if (filepath === target) throw Object.assign(new Error('cleanup failed'), { code: 'EPERM' })
        originalRmSync(filepath, options)
      })
      try {
        assert.throws(() => renameSync(source, target), { code: 'EPERM' })
        assert.strictEqual(fs.readFileSync(source, 'utf8'), 'source')
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'partial')
      } finally {
        remove.mock.restore()
        copy.mock.restore()
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should restore the source when deleting it after copy fails', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.mkdirSync(source)
      fs.writeFileSync(path.join(source, 'first'), 'first')
      fs.writeFileSync(path.join(source, 'second'), 'second')
      fs.writeFileSync(path.join(source, 'readonly'), 'readonly', { mode: 0o400 })
      let link = path.join(source, 'dangling-link')
      let hasLink = true
      try {
        fs.symlinkSync('missing', link, process.platform === 'win32' ? 'file' : undefined)
      } catch (_e) {
        // Keep the directory recovery assertions runnable without symlink support.
        hasLink = false
      }
      let originalRenameSync = fs.renameSync.bind(fs)
      let originalRmSync = fs.rmSync.bind(fs)
      let rename = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        if (oldPath === source) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
        originalRenameSync(oldPath, newPath)
      })
      let remove = t.mock.method(fs, 'rmSync', (filepath, options) => {
        if (filepath === source) {
          originalRmSync(path.join(source, 'first'))
          throw Object.assign(new Error('remove failed'), { code: 'EIO' })
        }
        originalRmSync(filepath, options)
      })
      try {
        assert.throws(() => renameSync(source, target), { code: 'EIO' })
        assert.strictEqual(fs.readFileSync(path.join(source, 'first'), 'utf8'), 'first')
        assert.strictEqual(fs.readFileSync(path.join(source, 'second'), 'utf8'), 'second')
        assert.strictEqual(fs.readFileSync(path.join(source, 'readonly'), 'utf8'), 'readonly')
        if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(source, 'readonly')).mode & 0o777, 0o400)
        if (hasLink) {
          assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true)
          assert.strictEqual(fs.readlinkSync(link), 'missing')
        }
        assert.strictEqual(fs.existsSync(target), false)
      } finally {
        remove.mock.restore()
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should retain the backup when source recovery fails', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'source')
      let originalRenameSync = fs.renameSync.bind(fs)
      let rename = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        if (oldPath === source) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
        originalRenameSync(oldPath, newPath)
      })
      let originalRmSync = fs.rmSync.bind(fs)
      let remove = t.mock.method(fs, 'rmSync', (filepath, options) => {
        if (filepath === source) throw Object.assign(new Error('remove failed'), { code: 'EIO' })
        originalRmSync(filepath, options)
      })
      let originalCopySync = fs.cpSync.bind(fs)
      let copy = t.mock.method(fs, 'cpSync', (oldPath, newPath, options) => {
        if (oldPath === target && newPath === source) throw Object.assign(new Error('recovery failed'), { code: 'EIO' })
        originalCopySync(oldPath, newPath, options)
      })
      try {
        assert.throws(() => renameSync(source, target), /backup remains/)
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'source')
      } finally {
        copy.mock.restore()
        remove.mock.restore()
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })

    it('should retain the backup when cleanup after source recovery fails', t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'source')
      let originalRenameSync = fs.renameSync.bind(fs)
      let rename = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        if (oldPath === source) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
        originalRenameSync(oldPath, newPath)
      })
      let originalRmSync = fs.rmSync.bind(fs)
      let remove = t.mock.method(fs, 'rmSync', (filepath, options) => {
        if (filepath === source || filepath === target) throw Object.assign(new Error('remove failed'), { code: 'EIO' })
        originalRmSync(filepath, options)
      })
      try {
        assert.throws(() => renameSync(source, target), /backup remains/)
        assert.strictEqual(fs.readFileSync(source, 'utf8'), 'source')
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'source')
      } finally {
        remove.mock.restore()
        rename.mock.restore()
        fs.rmSync(root, { force: true, recursive: true })
      }
    })
  })

  describe('uriToFsPath()', () => {
    it('should keep POSIX single-letter-colon paths absolute (#2974)', { skip: process.platform === 'win32' }, () => {
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
      assert.strictEqual(res, path.parse(process.cwd()).root.toLowerCase())
      res = normalizeFilePath('/a/b/')
      assert.strictEqual(res, path.resolve('/a/b').replace(/^[A-Z]:/, drive => drive.toLowerCase()))
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

    it('should check ignored symlinks by their own name', async () => {
      let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-git-ignore-'))
      try {
        await promisify(execFile)('git', ['init'], { cwd: dir })
        let target = path.join(dir, 'target.txt')
        let link = path.join(dir, 'ignored-link')
        fs.writeFileSync(target, '')
        fs.symlinkSync(target, link)
        fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored-link\n')
        assert.strictEqual(await isGitIgnored(link), true)
        assert.strictEqual(await isGitIgnored(target), false)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
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
      let root = path.parse(process.cwd()).root
      let dirs = parentDirs(path.join(root, 'a/b/c'))
      assert.deepStrictEqual(dirs, [root, path.join(root, 'a'), path.join(root, 'a/b')])
      assert.deepStrictEqual(parentDirs(root), [root])
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
      assert.strictEqual(res, normalizeFilePath(process.cwd()))
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
