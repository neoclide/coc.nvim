/* eslint-disable */
import helper from '../helper'
// import * as assert from 'assert'
import fs from 'fs'
import * as lsclient from '../../language-client'
import * as path from 'path'
import { URI } from 'vscode-uri'
import { Disposable } from 'vscode-languageserver-protocol'
import workspace from '../../workspace'
// import which from 'which'

let toDispose: Disposable
beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
  toDispose?.dispose()
})

afterEach(async () => {
  await helper.reset()
})

describe('Client integration', () => {

  it('should send file change notification', async () => {
    if (global.__TEST__) return
    let uri = URI.file(__filename)
    await workspace.openResource(uri.toString())
    let serverModule = path.join(__dirname, './server/testFileWatcher.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: ['css'],
      synchronize: {}, initializationOptions: {},
      middleware: {
      }
    }
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    await helper.wait(100)
    let file = path.join(__dirname, 'test.js')
    fs.writeFileSync(file, '', 'utf8')
    toDispose = Disposable.create(() => {
      fs.unlinkSync(file)
    })
    await helper.wait(300)
    let res = await client.sendRequest('custom/received')
    expect(res).toEqual({
      changes: [{
        uri: URI.file(file).toString(),
        type: 1
      }]
    })
  })
})
