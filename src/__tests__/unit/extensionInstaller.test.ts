import fs from 'fs'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'
import child_process from 'child_process'
import { getDependencies, getExtensionDependencies, Info, Installer, isNpmCommand, isYarn, minReleaseAge, registryUrl } from '../../extension/installer'
import { remove } from '../../util/fs'

const rcfile = path.join(os.tmpdir(), '.npmrc')
let tmpfolder: string
afterEach(() => {
  if (tmpfolder) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
  }
})

describe('utils', () => {
  it('should getDependencies & getExtensionDependencies', async t => {
    assert.deepStrictEqual(getDependencies({}), [])
    assert.deepStrictEqual(getDependencies({ dependencies: { 'coc.nvim': '0.0.1' } }), [])
    assert.deepStrictEqual(getExtensionDependencies({}), [])
    assert.deepStrictEqual(getExtensionDependencies({ extensionDependencies: ['extension-1', 'extension-1'] }), ['extension-1'])
  })

  it('should check command is npm or yarn', async t => {
    assert.strictEqual(isNpmCommand('npm'), true)
    assert.strictEqual(isYarn('yarnpkg'), true)
  })

  it('should get registry url', async t => {
    const getUrl = () => {
      return registryUrl(os.tmpdir())
    }
    fs.rmSync(rcfile, { force: true, recursive: true })
    assert.strictEqual(getUrl().toString(), 'https://registry.npmjs.org/')
    fs.writeFileSync(rcfile, '', 'utf8')
    assert.strictEqual(getUrl().toString(), 'https://registry.npmjs.org/')
    fs.writeFileSync(rcfile, 'coc.nvim:registry=https://example.org', 'utf8')
    assert.strictEqual(getUrl().toString(), 'https://example.org/')
    fs.writeFileSync(rcfile, '#coc.nvim:registry=https://example.org', 'utf8')
    assert.strictEqual(getUrl().toString(), 'https://registry.npmjs.org/')
    fs.writeFileSync(rcfile, 'coc.nvim:registry=example.org', 'utf8')
    assert.strictEqual(getUrl().toString(), 'https://registry.npmjs.org/')
    fs.rmSync(rcfile, { force: true, recursive: true })
  })

  it('should get minimum release age', () => {
    fs.rmSync(rcfile, { force: true })
    assert.strictEqual(minReleaseAge(os.tmpdir()), 0)
    fs.writeFileSync(rcfile, 'min-release-age = 3 # days\n', 'utf8')
    assert.strictEqual(minReleaseAge(os.tmpdir()), 3)
    fs.writeFileSync(rcfile, 'min-release-age = invalid\n', 'utf8')
    assert.strictEqual(minReleaseAge(os.tmpdir()), 0)
    fs.rmSync(rcfile, { force: true })
  })

  it('should parse name & version', async t => {
    const getInfo = (def: string): { name?: string, version?: string } => {
      let installer = new Installer(import.meta.dirname, 'npm', def)
      return installer.info
    }
    assert.deepStrictEqual(getInfo('https://github.com'), { name: undefined, version: undefined })
    assert.deepStrictEqual(getInfo('@yaegassy/coc-intelephense'), { name: '@yaegassy/coc-intelephense', version: undefined })
    assert.deepStrictEqual(getInfo('@yaegassy/coc-intelephense@1.0.0'), { name: '@yaegassy/coc-intelephense', version: '1.0.0' })
    assert.deepStrictEqual(getInfo('foo@1.0.0'), { name: 'foo', version: '1.0.0' })
  })
})

describe('Installer', () => {
  describe('fetch() & download()', () => {
    it('should throw with invalid url', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'foo')
      let fn = async () => {
        await installer.fetch('url')
      }
      await assert.rejects(fn(), )
      fn = async () => {
        await installer.download('url', { dest: '' })
      }
      await assert.rejects(fn(), )
    })
  })

  describe('getInfo()', () => {
    it('should get install arguments', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'https://github.com/')
      assert.deepStrictEqual(installer.getInstallArguments('pnpm', 'https://github.com/'), { env: 'development', args: ['install'] })
      assert.deepStrictEqual(installer.getInstallArguments('npm', ''), { env: 'production', args: ['install', '--ignore-scripts', '--no-package-lock', '--omit=dev', '--legacy-peer-deps', '--no-global'] })
      assert.deepStrictEqual(installer.getInstallArguments('yarn', ''), { env: 'production', args: ['install', '--ignore-scripts', '--no-lockfile', '--production', '--ignore-engines'] })
      assert.deepStrictEqual(installer.getInstallArguments('pnpm', ''), { env: 'production', args: ['install', '--ignore-scripts', '--no-lockfile', '--production', '--config.strict-peer-dependencies=false'] })
    })

    it('should getInfo from url', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'https://github.com/')
      let spy = t.mock.method(installer, 'getInfoFromUri', () => {
        return Promise.resolve({ name: 'vue-vscode-snippets', version: '1.0.0' })
      })
      let res = await installer.getInfo()
      assert.notStrictEqual(res, undefined)
    })

    it('should use latest version', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'coc-omni')
      let spy = t.mock.method(installer, 'fetch', url => {
        assert.match(url.toString(), new RegExp('coc-omni'))
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
      assert.notStrictEqual(info, undefined)
    })

    it('should respect min-release-age from npmrc', async t => {
      let npmrc = path.join(os.homedir(), '.npmrc')
      let original = fs.existsSync(npmrc) ? fs.readFileSync(npmrc) : undefined
      t.after(() => {
        if (original) fs.writeFileSync(npmrc, original)
        else fs.rmSync(npmrc, { force: true })
      })
      fs.writeFileSync(npmrc, 'min-release-age = 3 # days\n')
      let installer = new Installer(import.meta.dirname, 'npm', 'coc-omni')
      t.mock.method(installer, 'fetch', () => Promise.resolve(JSON.stringify({
        name: 'coc-omni',
        'dist-tags': { latest: '2.0.0' },
        time: {
          '1.0.0': new Date(Date.now() - 4 * 86400000).toISOString(),
          '2.0.0': new Date(Date.now() - 86400000).toISOString()
        },
        versions: {
          '1.0.0': { version: '1.0.0', dist: { tarball: 'old' }, engines: { coc: '>=0.0.80' } },
          '2.0.0': { version: '2.0.0', dist: { tarball: 'new' }, engines: { coc: '>=0.0.80' } }
        }
      })))
      let info = await installer.getInfo()
      assert.strictEqual(info.version, '1.0.0')
      assert.strictEqual(info['dist.tarball'], 'old')
    })

    it('should throw when version not found', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'coc-omni@1.0.2')
      let spy = t.mock.method(installer, 'fetch', () => {
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
      await assert.rejects(fn(), /doesn't exists/)
    })

    it('should throw when not coc.nvim extension', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'coc-omni')
      let spy = t.mock.method(installer, 'fetch', () => {
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
      await assert.rejects(fn(), /not a valid/)
    })
  })

  describe('getInfoFromUri()', () => {
    it('should throw for url that not supported', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'https://example.com')
      let fn = async () => {
        await installer.getInfoFromUri()
      }
      await assert.rejects(fn(), /not supported/)
      let deceptive = new Installer(import.meta.dirname, 'npm', 'https://github.com.example.com/owner/repo')
      await assert.rejects(() => deceptive.getInfoFromUri(), /not supported/)
    })

    it('should get info from url #1', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'https://github.com/sdras/vue-vscode-snippets')
      let spy = t.mock.method(installer, 'fetch', () => {
        return Promise.resolve(JSON.stringify({ name: 'vue-vscode-snippets', version: '1.0.0' }))
      })
      let info = await installer.getInfoFromUri()
      assert.match(info['dist.tarball'], /master.tar.gz/)
    })

    it('should get info from url #2', { timeout: 10000 }, async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'https://github.com/sdras/vue-vscode-snippets@main')
      let spy = t.mock.method(installer, 'fetch', () => {
        return Promise.resolve({ name: 'vue-vscode-snippets', version: '1.0.0', engines: { coc: '>=0.0.1' } })
      })
      let info = await installer.getInfoFromUri()
      assert.match(info['dist.tarball'], /main.tar.gz/)
      assert.deepStrictEqual(info['engines.coc'], '>=0.0.1')
    })
  })

  describe('update()', () => {
    it('should reject extension names outside the extension root', async () => {
      let installer = new Installer(os.tmpdir(), 'npm', 'foo')
      await assert.rejects(() => installer.doInstall({ name: '../outside' }), /Invalid extension name/)
      await assert.rejects(() => installer.doInstall({ name: '..\\outside' }), /Invalid extension name/)
      await assert.rejects(() => installer.doInstall({ name: '/outside' }), /Invalid extension name/)
    })

    it('should skip install & update for symbolic folder', async t => {
      tmpfolder = path.join(os.tmpdir(), 'foo')
      fs.rmSync(tmpfolder, { recursive: true, force: true })
      fs.symlinkSync(import.meta.dirname, tmpfolder, 'dir')
      let installer = new Installer(os.tmpdir(), 'npm', 'foo')
      let res = await installer.doInstall({ name: 'foo' })
      assert.strictEqual(res, false)
      let val = await installer.update()
      assert.strictEqual(val, undefined)
    })

    it('should update from url', async t => {
      let url = 'https://github.com/sdras/vue-vscode-snippets@main'
      let installer = new Installer(import.meta.dirname, 'npm', url)
      let spy = t.mock.method(installer, 'getInfo', () => {
        return Promise.resolve({ version: '1.0.0', name: 'vue-vscode-snippets' })
      })
      let s = t.mock.method(installer, 'doInstall', () => {
        return Promise.resolve(true)
      })
      let res = await installer.update(url)
      assert.notStrictEqual(res, undefined)
    })

    it('should skip update when current version is latest', async t => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '1.0.0'
      let spy = t.mock.method(installer, 'getInfo', () => {
        return Promise.resolve({ version })
      })
      let info = await installer.getInfo()
      fs.mkdirSync(tmpfolder)
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "${info.version}"}`, 'utf8')
      let res = await installer.update()
      assert.strictEqual(res, undefined)
    })

    it('should skip update when version not satisfies', async t => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '2.0.0'
      let spy = t.mock.method(installer, 'getInfo', () => {
        return Promise.resolve({ version, 'engines.coc': '>=99.0.0' })
      })
      fs.mkdirSync(tmpfolder)
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "1.0.0"}`, 'utf8')
      let fn = async () => {
        await installer.update()
      }
      await assert.rejects(fn(), Error)
    })

    it('should return undefined when update not performed', async t => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '2.0.0'
      let spy = t.mock.method(installer, 'getInfo', () => {
        return Promise.resolve({ version })
      })
      let s = t.mock.method(installer, 'doInstall', () => {
        return Promise.resolve(false)
      })
      fs.mkdirSync(tmpfolder)
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "1.0.0"}`, 'utf8')
      let res = await installer.update()
      assert.strictEqual(res, undefined)
    })

    it('should update extension', async t => {
      tmpfolder = path.join(os.tmpdir(), 'coc-pairs')
      let installer = new Installer(os.tmpdir(), 'npm', 'coc-pairs')
      let version = '2.0.0'
      let spy = t.mock.method(installer, 'getInfo', () => {
        return Promise.resolve({ version, name: 'coc-pairs' })
      })
      let s = t.mock.method(installer, 'doInstall', () => {
        return Promise.resolve(true)
      })
      fs.mkdirSync(tmpfolder, { recursive: true })
      fs.writeFileSync(path.join(tmpfolder, 'package.json'), `{"version": "1.0.0"}`, 'utf8')
      let res = await installer.update()
      assert.notStrictEqual(res, undefined)
      await remove(tmpfolder)
    })
  })

  describe('install()', () => {
    it('should throw when version not match required', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'coc-omni')
      let spy = t.mock.method(installer, 'getInfo', () => {
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
      await assert.rejects(fn(), Error)
    })

    it('should return install info', async t => {
      let installer = new Installer(import.meta.dirname, 'npm', 'coc-omni')
      let spy = t.mock.method(installer, 'getInfo', () => {
        return Promise.resolve({
          name: 'coc-omni',
          version: '1.0.0',
          'dist.tarball': '',
          'engines.coc': '>=0.0.1'
        })
      })
      let s = t.mock.method(installer, 'doInstall', () => {
        return Promise.resolve(true)
      })
      let res = await installer.install()
      assert.strictEqual(res.updated, true)
    })

    it('should throw and remove folder when download failed', async t => {
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let folder: string
      let option: any
      let spy = t.mock.method(installer, 'download', (_url, opt) => {
        folder = opt.dest
        option = opt
        fs.mkdirSync(folder, { recursive: true })
        throw new Error('my error')
      })
      let info: Info = { name: 'coc-omni', version: '1.0.0', 'dist.tarball': 'https://registry.npmjs.org/-/coc-omni-1.0.0.tgz' }
      let fn = async () => {
        await installer.doInstall(info)
      }
      await assert.rejects(fn(), Error)
      assert.strictEqual(option.etagAlgorithm, 'md5')
      let exists = fs.existsSync(folder)
      assert.strictEqual(exists, false)
    })

    it('should revert folder when download failed', async t => {
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let f = path.join(tmpfolder, 'coc-omni')
      fs.mkdirSync(f, { recursive: true })
      fs.writeFileSync(path.join(f, 'package.json'), '{}', 'utf8')
      let spy = t.mock.method(installer, 'download', () => {
        throw new Error('my error')
      })
      let info: Info = { name: 'coc-omni', version: '1.0.0', 'dist.tarball': 'tarball' }
      let fn = async () => {
        await installer.doInstall(info)
      }
      await assert.rejects(fn(), Error)
      let exist = fs.existsSync(path.join(f, 'package.json'))
      assert.strictEqual(exist, true)
    })

    it('should install new extension', async t => {
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let f = path.join(tmpfolder, 'coc-omni')
      let spy = t.mock.method(installer, 'download', (_url, option) => {
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
      assert.strictEqual(res, true)
      let exist = fs.existsSync(path.join(f, 'package.json'))
      assert.strictEqual(exist, true)
    })

    it('should install new version', async t => {
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      let installer = new Installer(tmpfolder, 'npm', 'coc-omni')
      let f = path.join(tmpfolder, 'coc-omni')
      fs.mkdirSync(f, { recursive: true })
      fs.writeFileSync(path.join(f, 'package.json'), '{}', 'utf8')
      let spy = t.mock.method(installer, 'download', (_url, option) => {
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
      assert.strictEqual(res, true)
      let exist = fs.existsSync(path.join(f, 'package.json'))
      assert.strictEqual(exist, true)
    })

    it('should install dependencies', async t => {
      let npm = path.resolve(import.meta.dirname, '../npm')
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(tmpfolder)
      let installer = new Installer(tmpfolder, npm, 'coc-omni')
      let called = false
      installer.on('message', () => {
        called = true
      })
      await installer.installDependencies(tmpfolder, ['a', 'b'])
      assert.strictEqual(called, true)
    })

    it('should not mutate process.env when installing dependencies', async t => {
      let npm = path.resolve(import.meta.dirname, '../npm')
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(tmpfolder)
      let installer = new Installer(tmpfolder, npm, 'coc-omni')
      let envBefore = process.env.NODE_ENV
      let spawnedEnv: NodeJS.ProcessEnv | undefined
      let fakeChild: any = {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        on(_event: string, cb: (...args: any[]) => void) {
          if (_event === 'exit') {
            setTimeout(() => cb(0), 0)
          }
          return fakeChild
        }
      }
      let spy = t.mock.method(child_process, 'spawn', (_cmd, _args, opts: any) => {
        spawnedEnv = opts.env
        return fakeChild
      })
      await installer.installDependencies(tmpfolder, ['a', 'b'])
      assert.strictEqual(spawnedEnv?.NODE_ENV, 'production')
      assert.strictEqual(process.env.NODE_ENV, envBefore)
    })

    it('should reject on install error', async t => {
      let npm = path.resolve(import.meta.dirname, '../npm')
      tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(tmpfolder)
      let installer = new Installer(tmpfolder, npm, 'coc-omni')
      let spy = t.mock.method(installer, 'getInstallArguments', () => {
        return { env: 'production', args: ['--error'] }
      })
      let fn = async () => {
        await installer.installDependencies(tmpfolder, ['a', 'b'])
      }
      await assert.rejects(fn(), Error)
    })

    it('should install extension dependencies', { timeout: 10000 }, async t => {
      let getInfoSpy = t.mock.method(Installer.prototype, 'getInfo', async function() {
        // @ts-expect-error this
        const name = this.info.name
        return { name, version: '1.0.0', 'dist.tarball': `https://example.com/${name}.tgz` }
      })
      let downloadSpy = t.mock.method(Installer.prototype, 'download', async function(url, options) {
        fs.mkdirSync(options.dest, { recursive: true })
        let name = path.basename(url, '.tgz')
        let pkg = {
          name,
          version: '1.0.0',
          engines: { coc: '>=0.0.1' },
          extensionDependencies: name === 'coc-extension-with-dependencies' ? ['coc-dependency-1', 'coc-dependency-2'] : []
        }
        fs.writeFileSync(path.join(options.dest, 'package.json'), JSON.stringify(pkg))
      })

      tmpfolder = path.join(os.tmpdir(), 'coc-test')
      let installer = new Installer(tmpfolder, 'npm', 'coc-extension-with-dependencies@1.0.0')
      await installer.install()

      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-extension-with-dependencies')), true)
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-dependency-1')), true)
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-dependency-2')), true)

    })

    it('should not leave main extension installed when extension dependency fails', async t => {
      let getInfoSpy = t.mock.method(Installer.prototype, 'getInfo', async function() {
        // @ts-expect-error this
        const name = this.info.name
        return { name, version: '1.0.0', 'dist.tarball': `https://example.com/${name}.tgz` }
      })
      let downloadSpy = t.mock.method(Installer.prototype, 'download', async function(url, options) {
        let name = path.basename(url, '.tgz')
        if (name === 'coc-bad-dependency') {
          throw new Error('download failed')
        }
        fs.mkdirSync(options.dest, { recursive: true })
        let pkg = {
          name,
          version: '1.0.0',
          engines: { coc: '>=0.0.1' },
          extensionDependencies: name === 'coc-main-with-bad-dep' ? ['coc-bad-dependency'] : []
        }
        fs.writeFileSync(path.join(options.dest, 'package.json'), JSON.stringify(pkg))
      })

      tmpfolder = path.join(os.tmpdir(), 'coc-test-fail')
      let installer = new Installer(tmpfolder, 'npm', 'coc-main-with-bad-dep@1.0.0')
      await assert.rejects(installer.install(), )
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-main-with-bad-dep')), false)

    })

    it('should skip shared dependency without misleading circular message', async t => {
      let getInfoSpy = t.mock.method(Installer.prototype, 'getInfo', async function() {
        // @ts-expect-error this
        const name = this.info.name
        return { name, version: '1.0.0', 'dist.tarball': `https://example.com/${name}.tgz` }
      })
      let downloadSpy = t.mock.method(Installer.prototype, 'download', async function(url, options) {
        let name = path.basename(url, '.tgz')
        fs.mkdirSync(options.dest, { recursive: true })
        let pkg: any = {
          name,
          version: '1.0.0',
          engines: { coc: '>=0.0.1' }
        }
        if (name === 'coc-main-shared') {
          pkg.extensionDependencies = ['coc-dep-a', 'coc-dep-b']
        } else if (name === 'coc-dep-a' || name === 'coc-dep-b') {
          pkg.extensionDependencies = ['coc-shared']
        }
        fs.writeFileSync(path.join(options.dest, 'package.json'), JSON.stringify(pkg))
      })

      tmpfolder = path.join(os.tmpdir(), 'coc-test-shared')
      let installer = new Installer(tmpfolder, 'npm', 'coc-main-shared@1.0.0')
      let messages: string[] = []
      installer.on('message', msg => {
        messages.push(msg)
      })
      await installer.install()
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-main-shared')), true)
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-dep-a')), true)
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-dep-b')), true)
      assert.strictEqual(fs.existsSync(path.join(tmpfolder, 'coc-shared')), true)
      assert.strictEqual(messages.some(m => m.includes('Skipping dependency: coc-shared')), true)
      assert.strictEqual(messages.some(m => m.includes('Skipping circular dependency')), false)

    })
  })
})
