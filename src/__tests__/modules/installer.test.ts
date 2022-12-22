import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { getDependencies, Info, Installer, isNpmCommand, isYarn, registryUrl } from '../../extension/installer'
import { remove } from '../../util/fs'

const rcfile = path.join(os.tmpdir(), '.npmrc')
let tmpfolder: string
afterEach(() => {
  if (tmpfolder) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
  }
})

describe('utils', () => {
  it('should getDependencies', async () => {
    expect(getDependencies({})).toEqual([])
    expect(getDependencies({ dependencies: { 'coc.nvim': '0.0.1' } })).toEqual([])
  })

  it('should check command is npm or yarn', async () => {
    expect(isNpmCommand('npm')).toBe(true)
    expect(isYarn('yarnpkg')).toBe(true)
  })

  it('should get registry url', async () => {
    const getUrl = () => {
      return registryUrl(os.tmpdir())
    }
    fs.rmSync(rcfile, { force: true, recursive: true })
    expect(getUrl().toString()).toBe('https://registry.npmjs.org/')
    fs.writeFileSync(rcfile, '', 'utf8')
    expect(getUrl().toString()).toBe('https://registry.npmjs.org/')
    fs.writeFileSync(rcfile, 'coc.nvim:registry=https://example.org', 'utf8')
    expect(getUrl().toString()).toBe('https://example.org/')
    fs.writeFileSync(rcfile, '#coc.nvim:registry=https://example.org', 'utf8')
    expect(getUrl().toString()).toBe('https://registry.npmjs.org/')
    fs.writeFileSync(rcfile, 'coc.nvim:registry=example.org', 'utf8')
    expect(getUrl().toString()).toBe('https://registry.npmjs.org/')
    fs.rmSync(rcfile, { force: true, recursive: true })
  })

  it('should parse name & version', async () => {
    const getInfo = (def: string): { name?: string, version?: string } => {
      let installer = new Installer(__dirname, 'npm', def)
      return installer.info
    }
    expect(getInfo('https://github.com')).toEqual({ name: undefined, version: undefined })
    expect(getInfo('@yaegassy/coc-intelephense')).toEqual({ name: '@yaegassy/coc-intelephense', version: undefined })
    expect(getInfo('@yaegassy/coc-intelephense@1.0.0')).toEqual({ name: '@yaegassy/coc-intelephense', version: '1.0.0' })
    expect(getInfo('foo@1.0.0')).toEqual({ name: 'foo', version: '1.0.0' })
  })
})

describe('Installer', () => {
  describe('fetch() & download()', () => {
    it('should throw with invalid url', async () => {
      let installer = new Installer(__dirname, 'npm', 'foo')
      let fn = async () => {
        await installer.fetch('url')
      }
      await expect(fn()).rejects.toThrow()
      fn = async () => {
        await installer.download('url', { dest: '' })
      }
      await expect(fn()).rejects.toThrow()
    })
  })

  describe('getInfo()', () => {
    it('should get install arguments', async () => {
      let installer = new Installer(__dirname, 'npm', 'https://github.com/')
      expect(installer.getInstallArguments('pnpm', 'https://github.com/')).toEqual(['install', '--production', '--config.strict-peer-dependencies=false'])
      expect(installer.getInstallArguments('npm', '')).toEqual(['install', '--ignore-scripts', '--no-lockfile', '--omit=dev', '--legacy-peer-deps', '--no-global'])
      expect(installer.getInstallArguments('yarn', '')).toEqual(['install', '--ignore-scripts', '--no-lockfile', '--production', '--ignore-engines'])
    })

    it('should getInfo from url', async () => {
      let installer = new Installer(__dirname, 'npm', 'https://github.com/')
      let spy = jest.spyOn(installer, 'getInfoFromUri').mockImplementation(() => {
        return Promise.resolve({ name: 'vue-vscode-snippets', version: '1.0.0' })
      })
      let res = await installer.getInfo()
      expect(res).toBeDefined()
      spy.mockRestore()
    })

    it('should use latest version', async () => {
      let installer = new Installer(__dirname, 'npm', 'coc-omni')
      let spy = jest.spyOn(installer, 'fetch').mockImplementation(url => {
        expect(url.toString()).toMatch('coc-omni')
        return Promise.resolve(JSON.stringify({
          name: 'coc-omni',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dist: { tarball: 'tarball' },
              engines: { coc: '>=0.0.80' }
            }
          }
        }))
      })
      let info = await installer.getInfo()
      expect(info).toBeDefined()
      spy.mockRestore()
    })

    it('should throw when version not found', async () => {
      let installer = new Installer(__dirname, 'npm', 'coc-omni@1.0.2')
      let spy = jest.spyOn(installer, 'fetch').mockImplementation(() => {
        return Promise.resolve(JSON.stringify({
          name: 'coc-omni',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dist: { tarball: 'tarball' },
              engines: { coc: '>=0.0.80' }
            }
          }
        }))
      })
      let fn = async () => {
        await installer.getInfo()
      }
      await expect(fn()).rejects.toThrow(/doesn't exists/)
      spy.mockRestore()
    })

    it('should throw when not coc.nvim extension', async () => {
      let installer = new Installer(__dirname, 'npm', 'coc-omni')
      let spy = jest.spyOn(installer, 'fetch').mockImplementation(() => {
        return Promise.resolve(JSON.stringify({
          name: 'coc-omni',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dist: { tarball: 'tarball' }
            }
          }
        }))
      })
      let fn = async () => {
        await installer.getInfo()
      }
      await expect(fn()).rejects.toThrow(/not a valid/)
      spy.mockRestore()
    })
  })

  describe('getInfoFromUri()', () => {
    it('should throw for url that not supported', async () => {
      let installer = new Installer(__dirname, 'npm', 'https://example.com')
      let fn = async () => {
        await installer.getInfoFromUri()
      }
      await expect(fn()).rejects.toThrow(/not supported/)
    })

    it('should get info from url #1', async () => {
      let installer = new Installer(__dirname, 'npm', 'https://github.com/sdras/vue-vscode-snippets')
      let spy = jest.spyOn(installer, 'fetch').mockImplementation(() => {
        return Promise.resolve(JSON.stringify({ name: 'vue-vscode-snippets', version: '1.0.0' }))
      })
      let info = await installer.getInfoFromUri()
      expect(info['dist.tarball']).toMatch(/master.tar.gz/)
      spy.mockRestore()
    })

    it('should get info from url #2', async () => {
      let installer = new Installer(__dirname, 'npm', 'https://github.com/sdras/vue-vscode-snippets@main')
      let spy = jest.spyOn(installer, 'fetch').mockImplementation(() => {
        return Promise.resolve({ name: 'vue-vscode-snippets', version: '1.0.0', engines: { coc: '>=0.0.1' } })
      })
      let info = await installer.getInfoFromUri()
      expect(info['dist.tarball']).toMatch(/main.tar.gz/)
      expect(info['engines.coc']).toEqual('>=0.0.1')
      spy.mockRestore()
    }, 10000)
  })

  describe('update()', () => {
    it('should skip install & update for symbolic folder', async () => {
      tmpfolder = path.join(os.tmpdir(), 'foo')
      fs.rmSync(tmpfolder, { recursive: true, force: true })
      fs.symlinkSync(__dirname, tmpfolder, 'dir')
      let installer = new Installer(os.tmpdir(), 'npm', 'foo')
      let res = await installer.doInstall({ name: 'foo' })
      expect(res).toBe(false)
      let val = await installer.update()
      expect(val).toBeUndefined()
    })

    it('should update from url', async () => {
      let url = 'https://github.com/sdras/vue-vscode-snippets@main'
      let installer = new Installer(__dirname, 'npm', url)
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({ version: '1.0.0', name: 'vue-vscode-snippets' })
      })
      let s = jest.spyOn(installer, 'doInstall').mockImplementation(() => {
        return Promise.resolve(true)
      })
      let res = await installer.update(url)
      expect(res).toBeDefined()
      spy.mockRestore()
      s.mockRestore()
    })

    it('should skip update when current version is latest', async () => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '1.0.0'
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({ version })
      })
      let info = await installer.getInfo()
      fs.mkdirSync(tmpfolder)
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "${info.version}"}`, 'utf8')
      let res = await installer.update()
      expect(res).toBeUndefined()
      spy.mockRestore()
    })

    it('should skip update when version not satisfies', async () => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '2.0.0'
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({ version, 'engines.coc': '>=99.0.0' })
      })
      fs.mkdirSync(tmpfolder)
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "1.0.0"}`, 'utf8')
      let fn = async () => {
        await installer.update()
      }
      await expect(fn()).rejects.toThrow(Error)
      spy.mockRestore()
    })

    it('should return undefined when update not performed', async () => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '2.0.0'
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({ version })
      })
      let s = jest.spyOn(installer, 'doInstall').mockImplementation(() => {
        return Promise.resolve(false)
      })
      fs.mkdirSync(tmpfolder)
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "1.0.0"}`, 'utf8')
      let res = await installer.update()
      expect(res).toBeUndefined()
      spy.mockRestore()
      s.mockRestore()
    })

    it('should update extension', async () => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '2.0.0'
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({ version, name: 'coc-pairs' })
      })
      let s = jest.spyOn(installer, 'doInstall').mockImplementation(() => {
        return Promise.resolve(true)
      })
      fs.mkdirSync(tmpfolder, { recursive: true })
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "1.0.0"}`, 'utf8')
      let res = await installer.update()
      expect(res).toBeDefined()
      spy.mockRestore()
      s.mockRestore()
      await remove(tmpfolder)
    })
  })

  describe('install()', () => {
    it('should throw when version not match required', async () => {
      let installer = new Installer(__dirname, 'npm', 'coc-omni')
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({
          name: 'coc-omni',
          version: '1.0.0',
          'dist.tarball': '',
          'engines.coc': '>=99.0.0'
        })
      })
      let fn = async () => {
        await installer.install()
      }
      await expect(fn()).rejects.toThrow(Error)
      spy.mockRestore()
    })

    it('should return install info', async () => {
      let installer = new Installer(__dirname, 'npm', 'coc-omni')
      let spy = jest.spyOn(installer, 'getInfo').mockImplementation(() => {
        return Promise.resolve({
          name: 'coc-omni',
          version: '1.0.0',
          'dist.tarball': '',
          'engines.coc': '>=0.0.1'
        })
      })
      let s = jest.spyOn(installer, 'doInstall').mockImplementation(() => {
        return Promise.resolve(true)
      })
      let res = await installer.install()
      expect(res.updated).toBe(true)
      s.mockRestore()
      spy.mockRestore()
    })

    it('should throw and remove folder when download failed', async () => {
      tmpfolder = path.join(os.tmpdir(), uuid())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let folder: string
      let option: any
      let spy = jest.spyOn(installer, 'download').mockImplementation((_url, opt) => {
        folder = opt.dest
        option = opt
        fs.mkdirSync(folder, { recursive: true })
        throw new Error('my error')
      })
      let info: Info = { name: 'coc-omni', version: '1.0.0', 'dist.tarball': 'https://registry.npmjs.org/-/coc-omni-1.0.0.tgz' }
      let fn = async () => {
        await installer.doInstall(info)
      }
      await expect(fn()).rejects.toThrow(Error)
      expect(option.etagAlgorithm).toBe('md5')
      let exists = fs.existsSync(folder)
      expect(exists).toBe(false)
      spy.mockRestore()
    })

    it('should revert folder when download failed', async () => {
      tmpfolder = path.join(os.tmpdir(), uuid())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let f = path.join(tmpfolder, 'coc-omni')
      fs.mkdirSync(f, { recursive: true })
      fs.writeFileSync(path.join(f, 'package.json'), '{}', 'utf8')
      let spy = jest.spyOn(installer, 'download').mockImplementation(() => {
        throw new Error('my error')
      })
      let info: Info = { name: 'coc-omni', version: '1.0.0', 'dist.tarball': 'tarball' }
      let fn = async () => {
        await installer.doInstall(info)
      }
      await expect(fn()).rejects.toThrow(Error)
      spy.mockRestore()
      let exist = fs.existsSync(path.join(f, 'package.json'))
      expect(exist).toBe(true)
    })

    it('should install new extension', async () => {
      tmpfolder = path.join(os.tmpdir(), uuid())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let f = path.join(tmpfolder, 'coc-omni')
      let spy = jest.spyOn(installer, 'download').mockImplementation((_url, option) => {
        if (option.onProgress) {
          option.onProgress('10')
        }
        fs.mkdirSync(option.dest, { recursive: true })
        let file = path.join(option.dest, 'package.json')
        fs.writeFileSync(file, '{version: "1.0.0"}', 'utf8')
        return Promise.resolve()
      })
      let info: Info = { name: 'coc-omni', version: '1.0.0', 'dist.tarball': 'tarball' }
      let res = await installer.doInstall(info)
      spy.mockRestore()
      expect(res).toBe(true)
      let exist = fs.existsSync(path.join(f, 'package.json'))
      expect(exist).toBe(true)
    })

    it('should install new version', async () => {
      tmpfolder = path.join(os.tmpdir(), uuid())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let f = path.join(tmpfolder, 'coc-omni')
      fs.mkdirSync(f, { recursive: true })
      fs.writeFileSync(path.join(f, 'package.json'), '{}', 'utf8')
      let spy = jest.spyOn(installer, 'download').mockImplementation((_url, option) => {
        if (option.onProgress) {
          option.onProgress('10')
        }
        fs.mkdirSync(option.dest, { recursive: true })
        let file = path.join(option.dest, 'package.json')
        fs.writeFileSync(file, '{version: "1.0.0"}', 'utf8')
        return Promise.resolve()
      })
      let info: Info = { name: 'coc-omni', version: '1.0.0', 'dist.tarball': 'tarball' }
      let res = await installer.doInstall(info)
      spy.mockRestore()
      expect(res).toBe(true)
      let exist = fs.existsSync(path.join(f, 'package.json'))
      expect(exist).toBe(true)
    })

    it('should install dependencies', async () => {
      let npm = path.resolve(__dirname, '../npm')
      tmpfolder = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(tmpfolder)
      let installer = new Installer(tmpfolder, npm, 'coc-omni')
      let called = false
      installer.on('message', () => {
        called = true
      })
      await installer.installDependencies(tmpfolder, ['a', 'b'])
      expect(called).toBe(true)
    })

    it('should reject on install error', async () => {
      let npm = path.resolve(__dirname, '../npm')
      tmpfolder = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(tmpfolder)
      let installer = new Installer(tmpfolder, npm, 'coc-omni')
      let spy = jest.spyOn(installer, 'getInstallArguments').mockImplementation(() => {
        return ['--error']
      })
      let fn = async () => {
        await installer.installDependencies(tmpfolder, ['a', 'b'])
      }
      await expect(fn()).rejects.toThrow(Error)
      spy.mockRestore()
    })
  })
})
