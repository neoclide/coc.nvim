import path from 'path'
import { DocumentSelector } from 'vscode-languageserver-protocol'
import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions, TransportKind } from '../../language-client/index'
import helper from '../helper'
import workspace from '../../workspace'

function createClient(section: string | string[] | undefined, middleware: Middleware = {}): LanguageClient {
  const serverModule = path.join(__dirname, './server/configServer.js')
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
  }

  const documentSelector: DocumentSelector = [{ scheme: 'file' }]
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {
      configurationSection: section
    },
    initializationOptions: {},
    middleware
  };
  (clientOptions as ({ $testMode?: boolean })).$testMode = true

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
    await helper.wait(50)
    expect(config).toBeDefined()
    expect(config[0].http).toBeDefined()
  })

  it('should request configurations with sections', async () => {
    let config: any
    client.middleware.workspace = client.middleware.workspace ?? {}
    client.middleware.workspace.configuration = (params, token, next) => {
      config = next(params, token)
      return config
    }
    await client.sendNotification('pull1')
    await helper.wait(50)
    expect(config).toBeDefined()
    expect(config.length).toBe(3)
    expect(config[1]).toBeNull()
    expect(config[0].proxy).toBeDefined()
    expect(config[2]).toBeNull()
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
    await helper.wait(50)
    expect(changed).toBeDefined()
    expect(changed).toEqual({ settings: {} })
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
    await helper.wait(50)
    expect(called).toBe(true)
    expect(changed).toBeDefined()
    expect(changed.settings.coc).toBeDefined()
    expect(changed.settings.npm).toBeDefined()
    let { configurations } = workspace
    configurations.updateUserConfig({ 'npm.binPath': 'cnpm' })
    await helper.wait(500)
    expect(changed.settings.npm).toBeDefined()
    expect(changed.settings.npm.binPath).toBe('cnpm')
    await client.stop()
  })
})
