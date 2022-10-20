import fs from 'fs'
import http, { Server } from 'http'
import os from 'os'
import path from 'path'
import tar from 'tar'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'
import { checkFileSha1, DependencySession, DependenciesInstaller, DependencyItem, findItem, getModuleInfo, getVersion, readDependencies, shouldRetry, untar, validVersionInfo, VersionInfo } from '../../extension/dependency'
import { Dependencies } from '../../extension/installer'
import { CancellationError } from '../../util/errors'
import { loadJson, remove, writeJson } from '../../util/fs'
import helper, { getPort } from '../helper'

process.env.NO_PROXY = '*'

describe('utils', () => {
  it('should check valid versionInfo', async () => {
    expect(validVersionInfo(null)).toBe(false)
    expect(validVersionInfo({ name: 3 })).toBe(false)
    expect(validVersionInfo({ name: 'name', version: '', dist: {} })).toBe(false)
    expect(validVersionInfo({
      name: 'name', version: '1.0.0', dist: {
        tarball: '',
        integrity: '',
        shasum: ''
      }
    })).toBe(true)
  })

  it('should checkFileSha1', async () => {
    let not_exists = path.join(os.tmpdir(), 'not_exists')
    let checked = await checkFileSha1(not_exists, 'shasum')
    expect(checked).toBe(false)
    let tarfile = path.resolve(__dirname, '../test.tar.gz')
    checked = await checkFileSha1(tarfile, 'bf0d88712fc3dbf6e3ab9a6968c0b4232779dbc4')
    expect(checked).toBe(true)
    // throw on error
    let bigfile = path.join(os.tmpdir(), 'bigfile')
    let buf = Buffer.allocUnsafe(1024 * 1024)
    fs.writeFileSync(bigfile, buf)
    let p = checkFileSha1(bigfile, '')
    fs.unlinkSync(bigfile)
    let res = await p
    expect(res).toBe(false)
  })

  it('should untar files', async () => {
    let tarfile = path.resolve(__dirname, '../test.tar.gz')
    let folder = path.join(os.tmpdir(), `test-${uuid()}`)
    await untar(folder, tarfile, 0)
    let file = path.join(folder, 'test.js')
    expect(fs.existsSync(file)).toBe(true)
    await remove(folder)
  })

  it('should throw on untar error', async () => {
    let fn = async () => {
      let file = path.join(os.tmpdir(), `note_exists_${uuid()}`)
      let folder = path.join(os.tmpdir(), `test-${uuid()}`)
      await untar(folder, file, 0)
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should throw when item not found', async () => {
    expect(() => {
      findItem('name', '^1.0.1', [])
    }).toThrow()
  })

  it('should getModuleInfo', () => {
    expect(() => {
      getModuleInfo('{')
    }).toThrow()
    expect(() => {
      getModuleInfo('{}')
    }).toThrow()
    expect(() => {
      getModuleInfo('{"name": "name"}')
    }).toThrow()
    let obj: any = { name: 'name', version: '1.0.0', versions: {} }
    expect(getModuleInfo(JSON.stringify(obj))).toBeDefined()
    obj = { name: 'name', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    expect(getModuleInfo(JSON.stringify(obj))).toBeDefined()
  })

  it('should check retry', () => {
    expect(shouldRetry({})).toBe(false)
    expect(shouldRetry({ message: 'message' })).toBe(false)
    expect(shouldRetry({ message: 'timeout' })).toBe(true)
    expect(shouldRetry({ message: 'ECONNRESET' })).toBe(true)
  })

  it('should readDependencies', () => {
    let dir = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(dir, { recursive: true })
    let filepath = path.join(dir, 'package.json')
    writeJson(filepath, { dependencies: { "coc.nvim": ">= 0.0.80", "is-number": "^1.0.0" } })
    let res = readDependencies(dir)
    expect(res).toEqual({ 'is-number': '^1.0.0' })
  })

  it('should getVersion', () => {
    expect(getVersion('>= 1.0.0', ['1.0.0', '2.0.0', '2.0.1'], '2.0.1')).toBe('2.0.1')
    expect(getVersion('^1.0.0', ['1.0.0', '1.1.0', '2.0.1'])).toBe('1.1.0')
    expect(getVersion('^3.0.0', ['1.0.0'])).toBeUndefined()
  })
})

describe('DependenciesInstaller', () => {
  let httpPort: number
  let server: Server
  let jsonResponses: Map<string, string> = new Map()
  let url: URL
  let dirs: string[] = []
  let createFiles = false
  let timer

  beforeAll(async () => {
    httpPort = await getPort()
    url = new URL(`http://127.0.0.1:${httpPort}`)
    server = await createServer(httpPort)
  })

  afterEach(async () => {
    jsonResponses.clear()
    for (let dir of dirs) {
      await remove(dir)
    }
    dirs = []
  })

  afterAll(() => {
    clearTimeout(timer)
    if (server) server.close()
  })

  async function createTarFile(name: string, version: string): Promise<string> {
    let folder = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'index.js'), '', 'utf8')
    writeJson(path.join(folder, 'package.json'), { name, version, dependencies: {} })
    let file = path.join(os.tmpdir(), uuid(), `${name}.${version}.tgz`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await tar.create({ file, gzip: true, cwd: path.dirname(folder) }, [path.basename(folder)])
    return file
  }

  async function createServer(port: number): Promise<Server> {
    return await new Promise(resolve => {
      const server = http.createServer(async (req, res) => {
        for (let [url, text] of jsonResponses.entries()) {
          if (req.url == url) {
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf8' })
            res.end(text)
            return
          }
        }
        if (req.url.endsWith('/slow')) {
          timer = setTimeout(() => {
            res.writeHead(100)
            res.end('abc')
          }, 300)
          return
        }
        if (req.url.endsWith('.tgz')) {
          res.setHeader('Content-Disposition', 'attachment; filename="file.tgz"')
          res.setHeader('Content-Type', 'application/octet-stream')
          let tarfile: string
          if (createFiles) {
            let parts = req.url.slice(1).replace(/\.tgz/, '').split('-')
            tarfile = await createTarFile(parts[0], parts[1])
          } else {
            tarfile = path.resolve(__dirname, '../test.tar.gz')
          }
          let stat = fs.statSync(tarfile)
          res.setHeader('Content-Length', stat.size)
          res.writeHead(200)
          let stream = fs.createReadStream(tarfile)
          stream.pipe(res)
        }
      })
      server.listen(port, () => {
        resolve(server)
      })
    })
  }

  function create(root: string | undefined, directory: string, onMessage?: (msg: string) => void): DependenciesInstaller {
    if (!root) {
      root = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(root)
      dirs.push(root)
    }
    let registry = new URL(`http://127.0.0.1:${httpPort}`)
    onMessage = onMessage ?? function() {}
    let session = new DependencySession(registry, root)
    return session.createInstaller(directory, onMessage)
  }

  function createVersion(name: string, version: string, dependencies?: Dependencies): VersionInfo {
    return {
      name,
      version,
      dependencies,
      dist: {
        shasum: '',
        integrity: '',
        tarball: `http://127.0.0.1:${httpPort}/${name}-${version}.tgz`,
      }
    }
  }

  function addJsonData(): void {
    // a => b, c, d
    // c => b, d
    // b => d
    jsonResponses.set('/a', JSON.stringify({
      name: 'a',
      versions: {
        '0.0.1': createVersion('a', '0.0.1', { b: '^1.0.0', c: '^2.0.0', d: '>= 0.0.1' })
      }
    }))
    jsonResponses.set('/b', JSON.stringify({
      name: 'b',
      versions: {
        '1.0.0': createVersion('b', '1.0.0', {}),
        '2.0.0': createVersion('b', '2.0.0', { d: '^1.0.0' }),
        '3.0.0': createVersion('b', '3.0.0', { d: '^1.0.0' }),
      }
    }))
    jsonResponses.set('/c', JSON.stringify({
      name: 'c',
      versions: {
        '1.0.0': createVersion('c', '1.0.0', {}),
        '2.0.0': createVersion('c', '2.0.0', { b: '^2.0.0', d: '^1.0.0' }),
        '3.0.0': createVersion('c', '3.0.0', { b: '^3.0.0', d: '^1.0.0' }),
      }
    }))
    jsonResponses.set('/d', JSON.stringify({
      name: 'd',
      versions: {
        '1.0.0': createVersion('d', '1.0.0')
      }
    }))
  }

  it('should throw on cancel', async () => {
    let root = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(root)
    dirs.push(root)
    let registry = new URL(`http://127.0.0.1:${httpPort}`)
    let session = new DependencySession(registry, root)
    let directory = path.join(os.tmpdir(), uuid())
    dirs.push(directory)
    writeJson(path.join(directory, 'package.json'), { dependencies: { foo: '>= 0.0.1' } })
    let one = session.createInstaller(directory, () => {})
    let spy = jest.spyOn(one, 'fetchInfos').mockImplementation(() => {
      return new Promise((resolve, reject) => {
        one.token.onCancellationRequested(() => {
          clearTimeout(timer)
          reject(new CancellationError())
        })
        let timer = setTimeout(() => {
          resolve()
        }, 500)
      })
    })
    let p = one.installDependencies()
    await helper.wait(30)
    one.cancel()
    let fn = async () => {
      await p
    }
    await expect(fn()).rejects.toThrow(Error)
    spy.mockRestore()
  })

  it('should throw when Cancellation requested', async () => {
    let install = create(undefined, '')
    install.cancel()
    let fn = async () => {
      await install.fetch(new URL('/', url), { timeout: 10 }, 3)
    }
    await expect(fn()).rejects.toThrow(CancellationError)
    fn = async () => {
      await install.download(new URL('/', url), 'filename', '')
    }
    await expect(fn()).rejects.toThrow(CancellationError)
  })

  it('should retry fetch', async () => {
    let install = create(undefined, '')
    let fn = async () => {
      await install.fetch(new URL('/', url), { timeout: 10 }, 3)
    }
    await expect(fn()).rejects.toThrow(Error)
    jsonResponses.set('/json', '{"result": "ok"}')
    let res = await install.fetch(new URL('/json', url), {}, 1)
    expect(res).toEqual({ result: 'ok' })
  })

  it('should cancel request', async () => {
    let install = create(undefined, '')
    let p = install.fetch(new URL('/slow', url), {}, 1)
    await helper.wait(10)
    let fn = async () => {
      install.cancel()
      await p
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should throw when unable to load info', async () => {
    let install = create(undefined, '')
    let fn = async () => {
      await install.loadInfo(url, 'foo', 10)
    }
    await expect(fn()).rejects.toThrow(Error)
    fn = async () => {
      await install.loadInfo(url, 'bar')
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should fetchInfos', async () => {
    addJsonData()
    let install = create(undefined, '')
    await install.fetchInfos({ a: '^0.0.1' })
    expect(install.resolvedInfos.size).toBe(4)
  })

  it('should linkDependencies', async () => {
    addJsonData()
    let install = create(undefined, '')
    await install.fetchInfos({ a: '^0.0.1' })
    let items: DependencyItem[] = []
    install.linkDependencies(undefined, items)
    expect(items).toEqual([])
    install.linkDependencies({ a: '^0.0.1' }, items)
    expect(items.length).toBe(5)
  })

  it('should retry download', async () => {
    let install = create(undefined, '')
    let fn = async () => {
      await install.download(new URL('res', url), 'res', '', 3, 10)
    }
    await expect(fn()).rejects.toThrow(Error)
    fn = async () => {
      await install.download(new URL('test.tgz', url), 'test.tgz', 'badsum')
    }
    await expect(fn()).rejects.toThrow(Error)
    let res = await install.download(new URL('test.tgz', url), 'test.tgz', '')
    expect(fs.existsSync(res)).toBe(true)
    fs.unlinkSync(res)
    res = await install.download(new URL('test.tgz', url), 'test.tgz', 'bf0d88712fc3dbf6e3ab9a6968c0b4232779dbc4')
    expect(fs.existsSync(res)).toBe(true)
    fs.unlinkSync(res)
  })

  it('should throw when unable to resolve version', async () => {
    let install = create(undefined, '')
    expect(() => {
      install.resolveVersion('foo', '^1.0.0')
    }).toThrow()
    install.resolvedInfos.set('foo', {
      name: 'foo',
      versions: {
        '2.0.0': {} as any
      }
    })
    expect(() => {
      install.resolveVersion('foo', '^1.0.0')
    }).toThrow()
    expect(() => {
      install.resolveVersion('foo', '^2.0.0')
    }).toThrow()
  })

  it('should check exists and download items', async () => {
    let items: DependencyItem[] = []
    items.push({
      integrity: '',
      name: 'foo',
      resolved: `http://127.0.0.1:${httpPort}/foo.tgz`,
      satisfiedVersions: [],
      shasum: 'bf0d88712fc3dbf6e3ab9a6968c0b4232779dbc4',
      version: '0.0.1'
    })
    items.push({
      integrity: '',
      name: 'bar',
      resolved: `http://127.0.0.1:${httpPort}/bar.tgz`,
      satisfiedVersions: ['^0.0.1'],
      shasum: 'bf0d88712fc3dbf6e3ab9a6968c0b4232779dbc4',
      version: '0.0.2'
    })
    let install = create(undefined, '')
    let dest = path.join(install.modulesRoot, '.cache')
    fs.mkdirSync(dest, { recursive: true })
    let tarfile = path.resolve(__dirname, '../test.tar.gz')
    fs.copyFileSync(tarfile, path.join(dest, `foo.0.0.1.tgz`))
    let res = await install.downloadItems(items, 1)
    expect(res.size).toBe(2)
  })

  it('should throw on error', async () => {
    let items: DependencyItem[] = []
    items.push({
      integrity: '',
      name: 'bar',
      resolved: `http://127.0.0.1:${httpPort}/bar.tgz`,
      satisfiedVersions: [],
      shasum: 'badsum',
      version: '0.0.2'
    })
    let install = create(undefined, '')
    let fn = async () => {
      await install.downloadItems(items, 2)
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should no nothing if no dependencies', async () => {
    let msg: string
    let directory = path.join(os.tmpdir(), uuid())
    let file = path.join(directory, 'package.json')
    writeJson(file, { dependencies: {} })
    let install = create(undefined, directory, s => {
      msg = s
    })
    await install.installDependencies()
    expect(msg).toMatch('No dependencies')
    fs.rmSync(directory, { recursive: true })
  })

  it('should install dependencies ', async () => {
    createFiles = true
    addJsonData()
    let directory = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(directory, { recursive: true })
    let file = path.join(directory, 'package.json')
    let install = create(undefined, directory)
    writeJson(file, { dependencies: { a: '^0.0.1' } })
    await install.installDependencies()
    let folder = path.join(directory, 'node_modules')
    let res = fs.readdirSync(folder)
    expect(res).toEqual(['a', 'b', 'c', 'd'])
    let obj = loadJson(path.join(folder, 'b/package.json')) as any
    expect(obj.version).toBe('1.0.0')
    obj = loadJson(path.join(folder, 'c/node_modules/b/package.json')) as any
    expect(obj.version).toBe('2.0.0')
    fs.rmSync(directory, { recursive: true })
  })
})
