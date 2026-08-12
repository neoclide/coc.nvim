import * as shared from '../sharedUtil'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'
import { CancellationToken, CodeActionRequest, CodeLensRequest, CompletionRequest, DidChangeWorkspaceFoldersNotification, DidCreateFilesNotification, DidDeleteFilesNotification, DidRenameFilesNotification, DocumentLinkRequest, DocumentSymbolRequest, ExecuteCommandRequest, InlayHintRequest, InlineValueRequest, Position, Range, RenameRequest, SemanticTokensRegistrationType, SymbolInformation, SymbolKind, TextDocumentContentRequest, WillDeleteFilesRequest, WillRenameFilesRequest, WorkspaceFolder, WorkspaceSymbolRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import * as lsclient from '../../language-client'
import { ClientState } from '../../language-client'
import { SemanticTokensFeature } from '../../language-client/semanticTokens'
import type { TextDocumentContentProviderShape } from '../../language-client/textDocumentContent'
import workspace from '../../workspace'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDynamicServer } from './server/inProcessDynamicServer'


afterEach(editorReset)

describe('DynamicFeature', () => {
  let textDocument = TextDocument.create('file:///1', 'vim', 1, '\n')
  let position = Position.create(1, 1)
  let token = CancellationToken.None

  async function startServer(opts: any = {}, middleware: lsclient.Middleware = {}): Promise<lsclient.LanguageClient> {
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: [{ language: '*' }],
      initializationOptions: opts,
      synchronize: {
        configurationSection: 'languageserver.vim.settings'
      },
      middleware
    }
    let serverOptions: lsclient.ServerOptions = inProcessDynamicServer()
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    return client
  }

  /**
   * Starts the dynamic server in-process over a duplex stream pair instead of
   * forking a child process (see inProcessDynamicServer.ts).
   */
  function inProcessDynamicServer(): lsclient.ServerOptions {
    return async () => {
      let serverInput = new PassThrough()
      let serverOutput = new PassThrough()
      createDynamicServer(serverInput, serverOutput)
      return { reader: serverOutput, writer: serverInput }
    }
  }

  describe('RenameFeature', () => {
    it('should start server', async t => {
      let called = false
      let client = await startServer({ prepareRename: false }, {
        handleRegisterCapability: async (params, next) => {
          await Promise.resolve(next(params, CancellationToken.None))
          return
        },
        handleUnregisterCapability: async (params, next) => {
          called = true
          await Promise.resolve(next(params, CancellationToken.None))
          return
        }
      })
      let feature = client.getFeature(RenameRequest.method)
      let provider = feature.getProvider(textDocument)
      assert.strictEqual(provider.prepareRename, undefined)
      feature.unregister('')
      client['_state'] = ClientState.StartFailed
      await shared.waitValue(() => called, true)
      await client.stop()
    })

    it('should keep registering after unknown method in batch', async t => {
      let originalOptions: any
      let client = await startServer({ prepareRename: false }, {
        handleRegisterCapability: async (params, next) => {
          let rename = params.registrations.find(o => o.method == RenameRequest.method)
          if (rename) originalOptions = rename.registerOptions
          // Unknown method first in the same batch must not drop the rest.
          params.registrations.unshift({ id: 'unknown-custom', method: 'custom/unknown' })
          await next(params, CancellationToken.None)
        }
      })
      // The dynamic workspace/symbol registration arrives in a later batch
      // with the same unknown method first; it must still be applied on top
      // of the static provider from initialize.
      let feature = client.getFeature(WorkspaceSymbolRequest.method)
      await shared.waitValue(() => feature.getProviders().length, 2)
      // The server's own registration object must not be mutated.
      await shared.waitValue(() => originalOptions != null, true)
      assert.strictEqual(originalOptions.documentSelector, undefined)
      await client.stop()
    })

    it('should handle different result', async t => {
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
      assert.notStrictEqual(provider.prepareRename, undefined)
      let res = await provider.prepareRename(textDocument, position, token)
      assert.strictEqual(res, null)

      await client.sendRequest('setPrepareResponse', { defaultBehavior: true })
      res = await provider.prepareRename(textDocument, position, token)
      assert.strictEqual(res, null)
      await client.sendRequest('setPrepareResponse', { range: Range.create(0, 0, 0, 3), placeholder: 'placeholder' })
      res = await provider.prepareRename(textDocument, position, token)
      assert.strictEqual((res as any).placeholder, 'placeholder')
      await assert.rejects(async () => {
        await client.sendRequest('setPrepareResponse', { defaultBehavior: false })
        res = await provider.prepareRename(textDocument, position, token)
      }, Error)
      await client.stop()
    })
  })

  describe('WorkspaceSymbolFeature', () => {
    it('should use middleware', async t => {
      let client = await startServer({}, {
        provideWorkspaceSymbols: (query, token, next) => {
          return next(query, token)
        },
        resolveWorkspaceSymbol: (item, token, next) => {
          return next(item, token)
        }
      })
      let feature = client.getFeature(WorkspaceSymbolRequest.method)
      await shared.waitValue(() => {
        return feature.getProviders().length
      }, 2)
      let provider = feature.getProviders().find(o => typeof o.resolveWorkspaceSymbol === 'function')
      assert.notStrictEqual(provider, undefined)
      let token = CancellationToken.None
      let res = await provider.provideWorkspaceSymbols('', token)
      assert.strictEqual(res.length, 0)
      let sym = SymbolInformation.create('name', SymbolKind.Array, Range.create(0, 1, 0, 1), 'file:///1')
      let resolved = await provider.resolveWorkspaceSymbol(sym, token)
      assert.strictEqual(resolved.name, sym.name)
      await client.stop()
    })
  })

  describe('SemanticTokensFeature', () => {
    it('should register semanticTokens', async t => {
      let client = await startServer({})
      let feature = client.getFeature(SemanticTokensRegistrationType.method)
      let provider: any
      await shared.waitValue(() => {
        provider = feature.getProvider(textDocument)
        return provider != null
      }, true)
      assert.strictEqual(provider.range, undefined)
      await client.stop()
    })

    it('should use middleware', async t => {
      let client = await startServer({ rangeTokens: true, delta: true }, {})
      let feature = client.getFeature(SemanticTokensRegistrationType.method)
      await shared.waitValue(() => {
        return feature.getProvider(textDocument) != null
      }, true)
      let provider = feature.getProvider(textDocument)
      assert.notStrictEqual(provider, undefined)
      assert.notStrictEqual(provider.range, undefined)
      let res = await provider.full.provideDocumentSemanticTokensEdits(textDocument, '2', CancellationToken.None)
      assert.strictEqual(res.resultId, '3')
      await client.stop()
    })
  })

  describe('CodeActionFeature', () => {
    it('should use registered command', async t => {
      let client = await startServer({})
      let feature = client.getFeature(CodeActionRequest.method)
      await shared.waitValue(() => {
        return feature.getProvider(textDocument) != null
      }, true)
      let provider = feature.getProvider(textDocument)
      let actions = await provider.provideCodeActions(textDocument, Range.create(0, 1, 0, 1), { diagnostics: [] }, token)
      assert.strictEqual(actions.length, 1)
      await client.stop()
    })
  })

  describe('PullConfigurationFeature', () => {
    it('should pull configuration for configured languageserver', async t => {
      shared.updateConfiguration('languageserver.vim.settings.foo', 'bar')
      let client = await startServer({})
      await client.sendNotification('pullConfiguration')
      await shared.waitValue(async () => {
        let res = await client.sendRequest('getConfiguration')
        return Array.isArray(res)
      }, true)
      let res = await client.sendRequest('getConfiguration')
      assert.strictEqual(Array.isArray(res), true)
      assert.deepStrictEqual(res[0], 'bar')
      shared.updateConfiguration('suggest.noselect', true)
      await shared.wait(20)
      await client.stop()
    })
  })

  describe('CodeLensFeature', () => {
    it('should use codeLens middleware', async t => {
      let fn = t.mock.fn()
      let client = await startServer({}, {
        provideCodeLenses: (doc, token, next) => {
          fn()
          return next(doc, token)
        },
        resolveCodeLens: (codelens, token, next) => {
          fn()
          return next(codelens, token)
        }
      })
      let feature = client.getFeature(CodeLensRequest.method)
      let provider = feature.getProvider(textDocument).provider
      assert.notStrictEqual(provider, undefined)
      let res = await provider.provideCodeLenses(textDocument, token)
      assert.strictEqual(res.length, 2)
      let resolved = await provider.resolveCodeLens(res[0], token)
      assert.notStrictEqual(resolved.command, undefined)
      assert.strictEqual(fn.mock.callCount(), 2)
      await client.stop()
    })

    it('should no resolve when resolve not exists', async t => {
      let client = await startServer({ noResolve: true }, {})
      let feature = client.getFeature(CodeLensRequest.method)
      let provider = feature.getProvider(textDocument).provider
      assert.notStrictEqual(provider, undefined)
      assert.strictEqual(provider.resolveCodeLens, undefined)
      {
        let feature = client.getFeature(DocumentLinkRequest.method)
        let provider = feature.getProvider(textDocument)
        assert.notStrictEqual(provider, undefined)
        assert.strictEqual(provider.resolveDocumentLink, undefined)
      }
      {
        let feature = client.getFeature(InlayHintRequest.method)
        let provider = feature.getProvider(textDocument).provider
        assert.notStrictEqual(provider, undefined)
        assert.strictEqual(provider.resolveInlayHint, undefined)
      }
      {
        let feature: SemanticTokensFeature
        await shared.waitValue(() => {
          feature = client.getFeature(SemanticTokensRegistrationType.method) as SemanticTokensFeature
          return feature != null && feature.getProvider(textDocument) != null
        }, true)
        let provider = feature.getProvider(textDocument).full
        assert.notStrictEqual(provider, undefined)
        assert.strictEqual(provider.provideDocumentSemanticTokensEdits, undefined)
      }
      await client.stop()
    })
  })

  describe('InlineValueFeature', () => {
    it('should fire refresh', async t => {
      let client = await startServer({})
      let feature = client.getFeature(InlineValueRequest.method)
      assert.notStrictEqual(feature, undefined)
      await shared.waitValue(() => {
        return feature.getProvider(textDocument) != null
      }, true)
      let provider = feature.getProvider(textDocument)
      let called = false
      provider.onDidChangeInlineValues.event(() => {
        called = true
      })
      await client.sendNotification('fireInlineValueRefresh')
      await shared.waitValue(() => {
        return called
      }, true)
      await client.stop()
    })
  })

  describe('ExecuteCommandFeature', () => {
    it('should register command with middleware', async t => {
      let called = false
      let client = await startServer({}, {
        executeCommand: (cmd, args, next) => {
          called = true
          return next(cmd, args)
        }
      })
      await shared.waitValue(() => {
        return commands.has('test_command')
      }, true)
      let feature = client.getFeature(ExecuteCommandRequest.method)
      assert.notStrictEqual(feature, undefined)
      feature.unregister('other_command')
      assert.strictEqual(feature.getState().kind, 'workspace')
      let res = await commands.executeCommand('test_command')
      assert.deepStrictEqual(res, { success: true })
      assert.strictEqual(called, true)
      let err
      let spy = t.mock.method(client, 'handleFailedRequest', (_type, _token, error) => {
        err = error
      })
      await commands.executeCommand('other_command')
      assert.match(err.message, /not exists/)
      await client.sendNotification('unregister')
      await shared.waitValue(() => {
        return commands.has('test_command')
      }, false)
      await client.stop()
    })

    it('should register command without middleware', async t => {
      let client = await startServer({}, {})
      await shared.waitValue(() => {
        return commands.has('test_command')
      }, true)
      let res = await commands.executeCommand('test_command')
      assert.deepStrictEqual(res, { success: true })
      await client.stop()
    })
  })

  describe('DocumentSymbolFeature', () => {
    it('should provide documentSymbols without middleware', async t => {
      let client = await startServer({}, {})
      let feature = client.getFeature(DocumentSymbolRequest.method)
      assert.notStrictEqual(feature, undefined)
      assert.notStrictEqual(feature.getState(), undefined)
      let provider = feature.getProvider(textDocument)
      let res = await provider.provideDocumentSymbols(textDocument, token)
      assert.deepStrictEqual(res, [])
      await client.stop()
    })

    it('should provide documentSymbols with middleware', async t => {
      let called = false
      let client = await startServer({ label: true }, {
        provideDocumentSymbols: (doc, token, next) => {
          called = true
          return next(doc, token)
        }
      })
      let feature = client.getFeature(DocumentSymbolRequest.method)
      let provider = feature.getProvider(textDocument)
      assert.deepStrictEqual(provider.meta, { label: 'test' })
      let res = await provider.provideDocumentSymbols(textDocument, token)
      assert.deepStrictEqual(res, [])
      assert.strictEqual(called, true)
      await client.stop()
    })
  })

  describe('FileOperationFeature', () => {
    it('should use middleware for FileOperationFeature', async t => {
      let n = 0
      let client = await startServer({}, {
        workspace: {
          didCreateFiles: (ev, next) => {
            n++
            return next(ev)
          },
          didRenameFiles: (ev, next) => {
            n++
            return next(ev)
          },
          didDeleteFiles: (ev, next) => {
            n++
            return Promise.reject(new Error('my error'))
          },
          willRenameFiles: (ev, next) => {
            n++
            return next(ev)
          },
          willDeleteFiles: (ev, next) => {
            n++
            return next(ev)
          }
        }
      })
      let createFeature = client.getFeature(DidCreateFilesNotification.method)
      createFeature.initialize({
        workspace: {
          fileOperations: { didCreate: { filters: [{ pattern: { glob: '' } }] } }
        }
      }, ['*'])
      await createFeature.send({ files: [URI.file('/a/b')] })
      let renameFeature = client.getFeature(DidRenameFilesNotification.method)
      await renameFeature.send({ files: [{ oldUri: URI.file('/a/b'), newUri: URI.file('/c/d') }] })
      let deleteFeature = client.getFeature(DidDeleteFilesNotification.method)
      await deleteFeature.send({ files: [URI.file('/x/y')] })
      let willRename = client.getFeature(WillRenameFilesRequest.method)
      await willRename.send({ files: [{ oldUri: URI.file(import.meta.dirname), newUri: URI.file(path.join(import.meta.dirname, 'x')) }], waitUntil: () => {} })
      let willDelete = client.getFeature(WillDeleteFilesRequest.method)
      await willDelete.send({ files: [URI.file('/x/y')], waitUntil: () => {} })
      await willDelete.send({ files: [], waitUntil: () => {} })
      await shared.waitValue(() => {
        return n
      }, 5)
      await client.stop()
    })

    it('should filter matches', async t => {
      let n = 0
      // os.tmpdir() is a symlink on macOS, create a real directory so the
      // folder filter matches it.
      let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-test-'))
      let client = await startServer({}, {
        workspace: {
          didCreateFiles: (ev, next) => {
            n += ev.files.length
            return next(ev)
          }
        }
      })
      let createFeature = client.getFeature(DidCreateFilesNotification.method)
      createFeature.initialize({
        workspace: {
          fileOperations: {
            didCreate: {
              filters: [
                { pattern: { glob: '**/', matches: 'folder' } },
                { pattern: { glob: '**', matches: 'file' } },
              ]
            }
          }
        }
      }, ['*'])
      await createFeature.send({ files: [URI.file(dir), URI.file(import.meta.filename)] })
      await shared.waitValue(() => n, 2)
      await client.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    })
  })

  describe('CompletionItemFeature', () => {
    it('should register multiple completion sources', async t => {
      let client = await startServer({}, {})
      let feature = client.getFeature(CompletionRequest.method)
      await shared.waitValue(() => {
        return feature.registrationLength
      }, 2)
      await client.stop()
    })
  })

  describe('WorkspaceFoldersFeature', () => {
    it('should register listeners', async t => {
      let client = await startServer({}, {})
      let feature = client.getFeature(DidChangeWorkspaceFoldersNotification.method)
      assert.notStrictEqual(feature, undefined)
      let state = feature.getState() as any
      assert.strictEqual(state.registrations, true)
      feature.register({ id: '1', registerOptions: undefined })
      feature.unregister('b346648e-88e0-44e3-91e3-52fd6addb8c7')
      feature.unregister('2')
      await client.stop()
    })

    it('should handle WorkspaceFoldersRequest', async t => {
      let client = await startServer({ changeNotifications: true }, {})
      let folders = workspace.workspaceFolders
      assert.strictEqual(folders.length, 0)
      await client.sendNotification('requestFolders')
      await shared.wait(20)
      let res = await client.sendRequest('getFolders')
      assert.strictEqual(res, null)
      workspace.workspaceFolderControl.addWorkspaceFolder(process.cwd(), true)
      await shared.wait(20)
      await client.stop()
    })

    it('should use workspaceFolders middleware', async t => {
      await workspace.loadFile(import.meta.filename)
      let folders = workspace.workspaceFolders
      assert.strictEqual(folders.length, 1)
      let called = false
      let fn = t.mock.fn()
      let client = await startServer({ changeNotifications: true }, {
        workspace: {
          workspaceFolders: (token, next) => {
            called = true
            return next(token)
          },
          didChangeWorkspaceFolders: () => {
            fn()
            return Promise.reject(new Error('my error'))
          }
        }
      })
      await client.sendNotification('requestFolders')
      await shared.waitValue(async () => {
        let res = await client.sendRequest('getFolders') as WorkspaceFolder[]
        return Array.isArray(res) && res.length == 1
      }, true)
      assert.strictEqual(called, true)
      workspace.workspaceFolderControl.addWorkspaceFolder(os.tmpdir(), true)
      assert.ok(fn.mock.callCount() > 0)
      await client.stop()
    })

    it('should send folders event with middleware', async t => {
      let called = false
      let client = await startServer({ changeNotifications: true }, {
        workspace: {
          didChangeWorkspaceFolders: (ev, next) => {
            called = true
            return next(ev)
          }
        }
      })
      let folders = workspace.workspaceFolders
      assert.strictEqual(folders.length, 0)
      await workspace.loadFile(import.meta.filename)
      await shared.waitValue(() => {
        return called
      }, true)
      await client.stop()
    })
  })

  describe('TextDocumentContentFeature', () => {
    it('should register static TextDocumentContent feature', async t => {
      let client = await startServer({ textDocumentContent: true }, {})
      let feature = client.getFeature(TextDocumentContentRequest.method)
      assert.strictEqual(feature.getState()['registrations'], true)
      let providers = feature.getProviders() as TextDocumentContentProviderShape[]
      let provider = providers[0]
      assert.strictEqual(provider.scheme, 'lsptest')
      let times = 0
      provider.provider.onDidChange(() => {
        times++
      })
      await client.sendNotification('fireDocumentContentRefresh')
      await shared.waitValue(() => times, 1)
      let uri = URI.parse('lsptest:///1')
      let spy = t.mock.method(client, 'sendRequest', () => Promise.resolve(undefined))
      let res = await provider.provider.provideTextDocumentContent(uri, token)
      assert.strictEqual(res, undefined)
      spy = t.mock.method(client, 'sendRequest', () => Promise.resolve({ text: 'foo' }))
      res = await provider.provider.provideTextDocumentContent(uri, token)
      assert.strictEqual(res, 'foo')
      spy = t.mock.method(client, 'sendRequest', () => Promise.reject(new Error('myerror')))
      await assert.rejects(Promise.resolve(provider.provider.provideTextDocumentContent(uri, token)), Error)
      feature.unregister('b346648e-88e0-44e3-91e3-52fd6addb8c7')
      assert.strictEqual(feature.getState()['registrations'], false)
      await client.stop()
    })
  })
})
