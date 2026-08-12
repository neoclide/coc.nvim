import path from 'path'
import { DidChangeConfigurationNotification, DocumentSelector } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { SyncConfigurationFeature } from '../../language-client/configuration'
import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions, TransportKind } from '../../language-client/index'
import workspace from '../../workspace'
import helper from '../helper'

function createClient(section: string | string[] | undefined, middleware: Middleware = {}, opts: Partial<LanguageClientOptions> = {}): LanguageClient {
  const serverModule = path.join(__dirname, './server/configServer.js')
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
  }

  const documentSelector: DocumentSelector = [{ scheme: 'file' }]
  const clientOptions: LanguageClientOptions = Object.assign({
    documentSelector,
    synchronize: {
      configurationSection: section
    },
    initializationOptions: {},
    middleware
  }, opts)

  const result = new LanguageClient('test', 'Test Language Server', serverOptions, clientOptions)
  return result
}

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('pull configuration feature', () => {
  let client: LanguageClient
  beforeAll(async () => {
    client = createClient(undefined)
    await client.start()
  })

  afterAll(async () => {
    await client.stop()
  })

  it('should request all configuration', async () => {
    let config: any
    client.middleware.workspace = client.middleware.workspace ?? {}
    client.middleware.workspace.configuration = (params, token, next) => {
      config = next(params, token)
      return config
    }
    await client.sendNotification('pull0')
    await helper.waitValue(() => {
      return config != null
    }, true)
    assert.notStrictEqual(config[0].http, undefined)
  })

  it('should request configurations with sections', async () => {
    let config: any
    client.middleware.workspace = client.middleware.workspace ?? {}
    client.middleware.workspace.configuration = (params, token, next) => {
      config = next(params, token)
      return config
    }
    await client.sendNotification('pull1')
    await helper.waitValue(() => {
      return config?.length
    }, 3)
    assert.strictEqual(config[1], null)
    assert.notStrictEqual(config[0].proxy, undefined)
    assert.strictEqual(config[2], null)
  })
})

describe('publish configuration feature', () => {
  it('should send configuration for languageserver', async () => {
    let client: LanguageClient
    client = createClient('languageserver.cpp.settings')
    let changed
    client.onNotification('configurationChange', params => {
      changed = params
    })
    await client.start()
    await helper.waitValue(() => {
      return changed != null
    }, true)
    assert.deepStrictEqual(changed, { settings: {} })
    await client.stop()
  })

  it('should get configuration from workspace folder', async () => {
    let folder = path.resolve(__dirname, '../sample')
    workspace.workspaceFolderControl.addWorkspaceFolder(folder, false)
    let configFilePath = path.join(folder, '.vim/coc-settings.json')
    workspace.configurations.addFolderFile(configFilePath, false, folder)
    let client = createClient('coc.preferences', {}, {
      workspaceFolder: { name: 'sample', uri: URI.file(folder).toString() }
    })
    let changed
    client.onNotification('configurationChange', params => {
      changed = params
    })
    await client.start()
    await helper.waitValue(() => {
      return changed != null
    }, true)
    assert.strictEqual(changed.settings.coc.preferences.rootPath, './src')
    workspace.workspaceFolderControl.removeWorkspaceFolder(folder)
    let feature = client.getFeature(DidChangeConfigurationNotification.method)
    feature.dispose()
    await client.stop()
  })

  it('should send configuration for specific sections', async () => {
    let client: LanguageClient
    let called = false
    client = createClient(['coc.preferences', 'npm', 'unknown'], {
      workspace: {
        didChangeConfiguration: (sections, next) => {
          called = true
          return next(sections)
        }
      }
    })
    let changed
    client.onNotification('configurationChange', params => {
      changed = params
    })
    await client.start()
    await helper.waitValue(() => {
      return called
    }, true)
    await helper.waitValue(() => {
      return changed != null
    }, true)
    assert.notStrictEqual(changed.settings.coc, undefined)
    assert.notStrictEqual(changed.settings.npm, undefined)
    let { configurations } = workspace
    configurations.updateMemoryConfig({ 'npm.binPath': 'cnpm' })
    await helper.waitValue(() => {
      return changed.settings.npm?.binPath
    }, 'cnpm')
    await client.stop()
  })

  it('should catch reject error', async () => {
    let client: LanguageClient
    let called = false
    client = createClient(['cpp'], {
      workspace: {
        didChangeConfiguration: () => {
          return Promise.reject(new Error('custom error'))
        }
      }
    })
    let changed
    client.onNotification('configurationChange', params => {
      changed = params
    })
    await client.start()
    await helper.wait(50)
    assert.strictEqual(called, false)
    void client.stop()
    await client.stop()
  })

  it('should send null settings', async () => {
    let client: LanguageClient
    client = createClient(['cpp'], {
      workspace: {
        didChangeConfiguration: (_sections, next) => {
          return next(null)
        }
      }
    })
    let changed
    client.onNotification('configurationChange', params => {
      changed = params
    })
    await client.start()
    await helper.waitValue(() => changed != null, true)
    assert.deepStrictEqual(changed, { settings: null })
    await client.stop()
  })

  it('should extractSettingsInformation', async () => {
    let res = SyncConfigurationFeature.extractSettingsInformation(['http.proxy', 'http.proxyCA'])
    assert.notStrictEqual(res.http, undefined)
    assert.notStrictEqual(res.http.proxy, undefined)
  })
})
