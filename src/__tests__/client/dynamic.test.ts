import path from 'path'
import { CancellationToken, Position, Range, RenameRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import * as lsclient from '../../language-client'
import helper from '../helper'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('Client events', () => {
  let textDocument = TextDocument.create('file:///1', 'vim', 1, '\n')
  let position = Position.create(1, 1)
  let token = CancellationToken.None

  async function startServer(opts: any = {}, middleware: lsclient.Middleware = {}): Promise<lsclient.LanguageClient> {
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: [{ language: '*' }],
      initializationOptions: opts,
      middleware
    }
    let serverModule = path.join(__dirname, './server/dynamicServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    return client
  }

  it('should start server', async () => {
    let client = await startServer({ prepareRename: false })
    let feature = client.getFeature(RenameRequest.method)
    let provider = feature.getProvider(textDocument)
    expect(provider.prepareRename).toBeUndefined()
    await client.stop()
  })

  it('should handle different result', async () => {
    let client = await startServer({ prepareRename: true }, {
      provideRenameEdits: (doc, pos, newName, token, next) => {
        return next(doc, pos, newName, token)
      },
      prepareRename: (doc, pos, token, next) => {
        return next(doc, pos, token)
      }
    })
    let feature = client.getFeature(RenameRequest.method)
    let provider = feature.getProvider(textDocument)
    expect(provider.prepareRename).toBeDefined()
    let res = await provider.prepareRename(textDocument, position, token)
    expect(res).toBeNull()

    await client.sendRequest('setPrepareResponse', { defaultBehavior: true })
    res = await provider.prepareRename(textDocument, position, token)
    expect(res).toBeNull()
    await client.sendRequest('setPrepareResponse', { range: Range.create(0, 0, 0, 3), placeholder: 'placeholder' })
    res = await provider.prepareRename(textDocument, position, token)
    expect((res as any).placeholder).toBe('placeholder')
    await expect(async () => {
      await client.sendRequest('setPrepareResponse', { defaultBehavior: false })
      res = await provider.prepareRename(textDocument, position, token)
    }).rejects.toThrow(Error)
    await client.stop()
  })
})
