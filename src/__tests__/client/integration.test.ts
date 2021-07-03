/* eslint-disable */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict'

import helper from '../helper'
import * as assert from 'assert'
import * as lsclient from '../../language-client'
import path from 'path'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

async function testLanguageServer(serverOptions: lsclient.ServerOptions): Promise<void> {
  let clientOptions: lsclient.LanguageClientOptions = {
    documentSelector: ['css'],
    synchronize: {},
    initializationOptions: {}
  }
  let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
  client.start()
  await client.onReady()
  expect(client.initializeResult).toBeDefined()
}

describe('Client integration', () => {

  it('should initialize use IPC channel', (done) => {
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      run: { module: serverModule, transport: lsclient.TransportKind.ipc },
      debug: { module: serverModule, transport: lsclient.TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
    }
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: ['css'],
      synchronize: {}, initializationOptions: {},
      middleware: {
        handleDiagnostics: (uri, diagnostics, next) => {
          assert.equal(uri, "uri:/test.ts")
          assert.ok(Array.isArray(diagnostics))
          assert.equal(diagnostics.length, 0)
          next(uri, diagnostics)
          disposable.dispose()
          done()
        }
      }
    }
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    let disposable = client.start()

    assert.equal(client.initializeResult, undefined)

    client.onReady().then(_ => {
      try {
        let expected = {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { resolveProvider: true, triggerCharacters: ['"', ':'] },
            hoverProvider: true,
            renameProvider: {
              prepareProvider: true
            }
          },
          customResults: {
            "hello": "world"
          }
        }
        assert.deepEqual(client.initializeResult, expected)
      } catch (e) {
        disposable.dispose()
        done(e)
      }
    }, e => {
      disposable.dispose()
      done(e)
    })
  })

  it('should initialize use stdio', async () => {
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    await testLanguageServer(serverOptions)
  })

  it('should initialize use pipe', async () => {
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.pipe
    }
    await testLanguageServer(serverOptions)
  })

  it('should initialize use socket', async () => {
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: {
        kind: lsclient.TransportKind.socket,
        port: 8088
      }
    }
    await testLanguageServer(serverOptions)
  })

  it('should initialize as command', async () => {
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    await testLanguageServer(serverOptions)
  })
})
