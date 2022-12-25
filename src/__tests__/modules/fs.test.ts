import { findUp, isDirectory, findMatch, watchFile, writeJson, loadJson, normalizeFilePath, checkFolder, getFileType, isGitIgnored, readFileLine, readFileLines, fileStartsWith, writeFile, remove, renameAsync, isParentFolder, parentDirs, inDirectory, getFileLineCount, sameFile, lineToLocation, resolveRoot, statAsync, FileType } from '../../util/fs'
import { v4 as uuid } from 'uuid'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { CancellationToken, CancellationTokenSource, Range } from 'vscode-languageserver-protocol'

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

describe('fs', () => {
  describe('normalizeFilePath()', () => {
    it('should fs normalizeFilePath', () => {
      let res = normalizeFilePath('//')
      expect(res).toBe('/')
      res = normalizeFilePath('/a/b/')
      expect(res).toBe('/a/b')
    })
  })

  it('should check directory', () => {
    expect(isDirectory(null)).toBe(false)
    expect(isDirectory('')).toBe(false)
    expect(isDirectory(__filename)).toBe(false)
    expect(isDirectory(process.cwd())).toBe(true)
  })

  it('should watch file', async () => {
    let filepath = path.join(os.tmpdir(), uuid())
    fs.writeFileSync(filepath, 'file', 'utf8')
    let called = false
    let disposable = watchFile(filepath, () => {
      called = true
    }, true)
    fs.writeFileSync(filepath, 'new file', 'utf8')
    await wait(2)
    disposable.dispose()
    disposable = watchFile('file_not_exists', () => {}, true)
    disposable.dispose()
  })

  describe('stat()', () => {
    it('fs statAsync', async () => {
      let res = await statAsync(__filename)
      expect(res).toBeDefined
      expect(res.isFile()).toBe(true)
    })

    it('fs statAsync #1', async () => {
      let res = await statAsync(path.join(__dirname, 'file_not_exist'))
      expect(res).toBeNull
    })
  })

  describe('loadJson()', () => {
    it('should loadJson()', () => {
      let file = path.join(__dirname, 'not_exists.json')
      expect(loadJson(file)).toEqual({})
    })

    it('should loadJson with bad format', async () => {
      let file = path.join(os.tmpdir(), uuid())
      fs.writeFileSync(file, 'foo', 'utf8')
      expect(loadJson(file)).toEqual({})
    })
  })

  describe('writeJson()', () => {
    it('should writeJson file', async () => {
      let file = path.join(os.tmpdir(), uuid())
      writeJson(file, { x: 1 })
      expect(loadJson(file)).toEqual({ x: 1 })
    })

    it('should create file with folder', async () => {
      let file = path.join(os.tmpdir(), uuid(), 'foo', 'bar')
      writeJson(file, { foo: '1' })
      expect(loadJson(file)).toEqual({ foo: '1' })
    })
  })

  describe('lineToLocation', () => {
    it('should not throw when file not exists', async () => {
      let res = await lineToLocation(path.join(os.tmpdir(), 'not_exists'), 'ab')
      expect(res).toBeDefined()
    })

    it('should use empty range when not found', async () => {
      let res = await lineToLocation(__filename, 'a'.repeat(100))
      expect(res).toBeDefined()
      expect(res.range).toEqual(Range.create(0, 0, 0, 0))
    })

    it('should get location', async () => {
      let file = path.join(os.tmpdir(), uuid())
      fs.writeFileSync(file, '\nfoo\n', 'utf8')
      let res = await lineToLocation(file, 'foo', 'foo')
      expect(res.range).toEqual(Range.create(1, 0, 1, 3))
    })
  })

  describe('remove()', () => {
    it('should remove files', async () => {
      await remove(path.join(os.tmpdir(), uuid()))
      let p = path.join(os.tmpdir(), uuid())
      fs.writeFileSync(p, 'data', 'utf8')
      await remove(p)
      let exists = fs.existsSync(p)
      expect(exists).toBe(false)
      await remove(undefined)
    })

    it('should not throw error', async () => {
      let spy = jest.spyOn(fs, 'rm').mockImplementation(() => {
        throw new Error('my error')
      })
      let p = path.join(os.tmpdir(), uuid())
      await remove(p)
      spy.mockRestore()
    })

    it('should remove folder', async () => {
      let f = path.join(os.tmpdir(), uuid())
      let p = path.join(f, 'a/b/c')
      fs.mkdirSync(p, { recursive: true })
      await remove(f)
      let exists = fs.existsSync(f)
      expect(exists).toBe(false)
    })
  })

  describe('getFileType()', () => {
    it('should get filetype', async () => {
      let res = await getFileType(__dirname)
      expect(res).toBe(FileType.Directory)
      res = await getFileType(__filename)
      expect(res).toBe(FileType.File)
      let newPath = path.join(os.tmpdir(), uuid())
      fs.symlinkSync(__filename, newPath)
      res = await getFileType(newPath)
      expect(res).toBe(FileType.SymbolicLink)
      fs.unlinkSync(newPath)
      let spy = jest.spyOn(fs, 'lstat').mockImplementation((...args) => {
        let cb = args[args.length - 1] as Function
        return cb(undefined, {
          isFile: () => { return false },
          isDirectory: () => { return false },
          isSymbolicLink: () => { return false }
        })
      })
      res = await getFileType('__file')
      expect(res).toBe(FileType.Unknown)
      spy.mockRestore()
    })
  })

  describe('checkFolder()', () => {
    it('should check file in folder', async () => {
      let cwd = process.cwd()
      let res = await checkFolder(cwd, ['package.json'])
      expect(res).toBe(true)
      res = await checkFolder(cwd, ['**/schema.json', 'package.json'])
      expect(res).toBe(true)
      res = await checkFolder(cwd, [])
      expect(res).toBe(false)
      res = await checkFolder(cwd, ['not_exists_fs'], CancellationToken.None)
      expect(res).toBe(false)
      res = await checkFolder(os.homedir(), ['not_exists_fs'])
      expect(res).toBe(false)
      res = await checkFolder('/a/b/c', ['not_exists_fs'])
      expect(res).toBe(false)
      let tokenSource = new CancellationTokenSource()
      let p = checkFolder(cwd, ['**/a.java'], tokenSource.token)
      let fn = async () => {
        tokenSource.cancel()
        res = await p
      }
      await expect(fn()).rejects.toThrow(Error)
      expect(res).toBe(false)
    })
  })

  describe('renameAsync()', () => {
    it('should rename file', async () => {
      let id = uuid()
      let filepath = path.join(os.tmpdir(), id)
      await writeFile(filepath, id)
      let dest = path.join(os.tmpdir(), 'bar')
      await renameAsync(filepath, dest)
      let exists = fs.existsSync(dest)
      expect(exists).toBe(true)
      fs.unlinkSync(dest)
    })

    it('should throw when file does not exist', async () => {
      let err
      try {
        await renameAsync('/foo/bar', '/a')
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
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
      expect(err).toBeDefined()
    })
  })

  describe('sameFile', () => {
    it('should be casesensitive', () => {
      expect(sameFile('/a', '/A', false)).toBe(false)
      expect(sameFile('/a', '/A', true)).toBe(true)
    })
  })

  describe('readFileLine', () => {
    it('should read line', async () => {
      let res = await readFileLine(__filename, 1)
      expect(res).toBeDefined()
      res = await readFileLine(__filename, 9999)
      expect(res).toBeDefined()
      expect(res).toBe('')
    })

    it('should throw when file does not exist', async () => {
      const fn = async () => {
        await readFileLine(__filename + 'fooobar', 1)
      }
      await expect(fn()).rejects.toThrow(Error)
    })
  })

  describe('readFileLines', () => {
    it('should throw when file does not exist', async () => {
      const fn = async () => {
        await readFileLines(__filename + 'fooobar', 0, 3)
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should read lines', async () => {
      let res = await readFileLines(__filename, 0, 1)
      expect(res.length).toBe(2)
    })
  })

  describe('fileStartsWith()', () => {
    it('should check casesensitive case', () => {
      expect(fileStartsWith('/a/b', '/A', false)).toBe(false)
      expect(fileStartsWith('/a/b', '/A', true)).toBe(true)
    })
  })

  describe('isGitIgnored()', () => {
    it('should be not ignored', async () => {
      let res = await isGitIgnored(__filename)
      expect(res).toBeFalsy()
      let filepath = path.join(process.cwd(), 'build/index.js')
      res = await isGitIgnored(filepath)
      expect(res).toBe(true)
    })

    it('should be ignored', async () => {
      let res = await isGitIgnored('')
      let uid = uuid()
      expect(res).toBe(false)
      res = await isGitIgnored(path.join(os.tmpdir(), uid))
      expect(res).toBe(false)
      res = await isGitIgnored(path.resolve(__dirname, '../lib/index.js.map'))
      expect(res).toBe(false)
      res = await isGitIgnored(__filename)
      expect(res).toBe(false)
      let filepath = path.join(os.tmpdir(), uid)
      fs.writeFileSync(filepath, '', { encoding: 'utf8' })
      res = await isGitIgnored(filepath)
      expect(res).toBe(false)
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    })
  })

  describe('inDirectory', () => {
    it('should support wildcard', async () => {
      let res = inDirectory(__dirname, ['**/file_not_exist.json'])
      expect(res).toBe(false)
    })
  })

  describe('parentDirs', () => {
    it('get parentDirs', () => {
      let dirs = parentDirs('/a/b/c')
      expect(dirs).toEqual(['/', '/a', '/a/b'])
      expect(parentDirs('/')).toEqual(['/'])
    })
  })

  describe('isParentFolder', () => {
    it('check parent folder', () => {
      expect(isParentFolder('/a/b', '/a/b/')).toBe(false)
      expect(isParentFolder('/a', '/a/b')).toBe(true)
      expect(isParentFolder('/a/b', '/a/b')).toBe(false)
      expect(isParentFolder('/a/b', '/a/b', true)).toBe(true)
      expect(isParentFolder('//', '/', true)).toBe(true)
      expect(isParentFolder('/a/b/', '/a/b/c', true)).toBe(true)
    })
  })

  describe('resolveRoot', () => {
    it('resolve root consider root path', () => {
      let res = resolveRoot(__dirname, ['.git'])
      expect(res).toMatch('coc.nvim')
    })

    it('should ignore glob pattern', () => {
      let res = resolveRoot(__dirname, [path.basename(__filename)], undefined, false, false, ["**/__tests__/**"])
      expect(res).toBeFalsy()
    })

    it('should ignore glob pattern bottom up', () => {
      let res = resolveRoot(__dirname, [path.basename(__filename)], undefined, true, false, ["**/__tests__/**"])
      expect(res).toBeFalsy()
    })

    it('should resolve from parent folders', () => {
      let root = path.resolve(__dirname, '../extensions/snippet-sample')
      let res = resolveRoot(root, ['package.json'])
      expect(res.endsWith('coc.nvim')).toBe(true)
    })

    it('should resolve from parent folders with bottom-up method', () => {
      let dir = path.join(os.tmpdir(), 'extensions/snippet-sample')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.resolve(dir, '../package.json'), '{}')
      let res = resolveRoot(dir, ['package.json'], null, true)
      expect(res.endsWith('extensions')).toBe(true)
      fs.rmSync(path.dirname(dir), { recursive: true, force: true })
    })

    it('should resolve to cwd', () => {
      let root = path.resolve(__dirname, '../../..')
      let res = resolveRoot(root, ['package.json'], root, false, true)
      expect(res).toBe(root)
    })

    it('should resolve to root', () => {
      let root = path.resolve(__dirname, '../extensions/test/')
      let res = resolveRoot(root, ['package.json'], root, false, false)
      expect(res).toBe(path.resolve(__dirname, '../../../'))
    })

    it('should not resolve to home', () => {
      let res = resolveRoot(__dirname, ['.config'], undefined, false, false, [os.homedir()])
      expect(res != os.homedir()).toBeTruthy()
    })
  })

  describe('findUp', () => {
    it('should findMatch by pattern', async () => {
      let res = findMatch(process.cwd(), ['*.json'])
      expect(res).toMatch('.json')
      res = findMatch(process.cwd(), ['*.json_not_exists'])
      expect(res).toBeUndefined()
    })

    it('findUp by filename', () => {
      let filepath = findUp('package.json', __dirname)
      expect(filepath).toMatch('coc.nvim')
      filepath = findUp('not_exists', __dirname)
      expect(filepath).toBeNull()
    })

    it('findUp by filenames', async () => {
      let filepath = findUp(['src'], __dirname)
      expect(filepath).toMatch('coc.nvim')
    })
  })
})
