import os from 'os'
import path from 'path'
import { CancellationToken, CodeActionRequest, CodeLensRequest, CompletionRequest, DidChangeWorkspaceFoldersNotification, DidCreateFilesNotification, DidDeleteFilesNotification, DidRenameFilesNotification, DocumentLinkRequest, DocumentSymbolRequest, ExecuteCommandRequest, InlayHintRequest, InlineValueRequest, Position, Range, RenameRequest, SemanticTokensRegistrationType, SymbolInformation, SymbolKind, TextDocumentContentRequest, WillDeleteFilesRequest, WillRenameFilesRequest, WorkspaceFolder, WorkspaceSymbolRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import * as lsclient from '../../language-client'
import { ClientState } from '../../language-client'
import { SemanticTokensFeature } from '../../language-client/semanticTokens'
import type { TextDocumentContentProviderShape } from '../../language-client/textDocumentContent'
import workspace from '../../workspace'
import helper from '../helper'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

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
    let serverModule = path.join(__dirname, './server/dynamicServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    return client
  }

  describe('RenameFeature', () => {
    it('should start server', async () => {
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
      expect(provider.prepareRename).toBeUndefined()
      feature.unregister('')
      client['_state'] = ClientState.StartFailed
      await helper.waitValue(() => called, true)
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

  describe('WorkspaceSymbolFeature', () => {
    it('should use middleware', async () => {
      let client = await startServer({}, {
        provideWorkspaceSymbols: (query, token, next) => {
          return next(query, token)
        },
        resolveWorkspaceSymbol: (item, token, next) => {
          return next(item, token)
        }
      })
      let feature = client.getFeature(WorkspaceSymbolRequest.method)
      await helper.waitValue(() => {
        return feature.getProviders().length
      }, 2)
      let provider = feature.getProviders().find(o => typeof o.resolveWorkspaceSymbol === 'function')
      expect(provider).toBeDefined()
      let token = CancellationToken.None
      let res = await provider.provideWorkspaceSymbols('', token)
      expect(res.length).toBe(0)
      let sym = SymbolInformation.create('name', SymbolKind.Array, Range.create(0, 1, 0, 1), 'file:///1')
      let resolved = await provider.resolveWorkspaceSymbol(sym, token)
      expect(resolved.name).toBe(sym.name)
      await client.stop()
    })
  })

  describe('SemanticTokensFeature', () => {
    it('should register semanticTokens', async () => {
      let client = await startServer({})
      let feature = client.getFeature(SemanticTokensRegistrationType.method)
      let provider: any
      await helper.waitValue(() => {
        provider = feature.getProvider(textDocument)
        return provider != null
      }, true)
      expect(provider.range).toBeUndefined()
      await client.stop()
    })

    it('should use middleware', async () => {
      let client = await startServer({ rangeTokens: true, delta: true }, {})
      let feature = client.getFeature(SemanticTokensRegistrationType.method)
      await helper.waitValue(() => {
        return feature.getProvider(textDocument) != null
      }, true)
      let provider = feature.getProvider(textDocument)
      expect(provider).toBeDefined()
      expect(provider.range).toBeDefined()
      let res = await provider.full.provideDocumentSemanticTokensEdits(textDocument, '2', CancellationToken.None)
      expect(res.resultId).toBe('3')
      await client.stop()
    })
  })

  describe('CodeActionFeature', () => {
    it('should use registered command', async () => {
      let client = await startServer({})
      let feature = client.getFeature(CodeActionRequest.method)
      await helper.waitValue(() => {
        return feature.getProvider(textDocument) != null
      }, true)
      let provider = feature.getProvider(textDocument)
      let actions = await provider.provideCodeActions(textDocument, Range.create(0, 1, 0, 1), { diagnostics: [] }, token)
      expect(actions.length).toBe(1)
      await client.stop()
    })
  })

  describe('PullConfigurationFeature', () => {
    it('should pull configuration for configured languageserver', async () => {
      helper.updateConfiguration('languageserver.vim.settings.foo', 'bar')
      let client = await startServer({})
      await client.sendNotification('pullConfiguration')
      await helper.wait(50)
      let res = await client.sendRequest('getConfiguration')
      expect(Array.isArray(res)).toBe(true)
      expect(res[0]).toEqual('bar')
      helper.updateConfiguration('suggest.noselect', true)
      await helper.wait(20)
      await client.stop()
    })
  })

  describe('CodeLensFeature', () => {
    it('should use codeLens middleware', async () => {
      let fn = jest.fn()
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
      expect(provider).toBeDefined()
      let res = await provider.provideCodeLenses(textDocument, token)
      expect(res.length).toBe(2)
      let resolved = await provider.resolveCodeLens(res[0], token)
      expect(resolved.command).toBeDefined()
      expect(fn).toHaveBeenCalledTimes(2)
      await client.stop()
    })

    it('should no resolve when resolve not exists', async () => {
      let client = await startServer({ noResolve: true }, {})
      let feature = client.getFeature(CodeLensRequest.method)
      let provider = feature.getProvider(textDocument).provider
      expect(provider).toBeDefined()
      expect(provider.resolveCodeLens).toBeUndefined()
      {
        let feature = client.getFeature(DocumentLinkRequest.method)
        let provider = feature.getProvider(textDocument)
        expect(provider).toBeDefined()
        expect(provider.resolveDocumentLink).toBeUndefined()
      }
      {
        let feature = client.getFeature(InlayHintRequest.method)
        let provider = feature.getProvider(textDocument).provider
        expect(provider).toBeDefined()
        expect(provider.resolveInlayHint).toBeUndefined()
      }
      {
        let feature: SemanticTokensFeature
        await helper.waitValue(() => {
          feature = client.getFeature(SemanticTokensRegistrationType.method) as SemanticTokensFeature
          return feature != null && feature.getProvider(textDocument) != null
        }, true)
        let provider = feature.getProvider(textDocument).full
        expect(provider).toBeDefined()
        expect(provider.provideDocumentSemanticTokensEdits).toBeUndefined()
      }
      await client.stop()
    })
  })

  describe('InlineValueFeature', () => {
    it('should fire refresh', async () => {
      let client = await startServer({})
      let feature = client.getFeature(InlineValueRequest.method)
      expect(feature).toBeDefined()
      await helper.waitValue(() => {
        return feature.getProvider(textDocument) != null
      }, true)
      let provider = feature.getProvider(textDocument)
      let called = false
      provider.onDidChangeInlineValues.event(() => {
        called = true
      })
      await client.sendNotification('fireInlineValueRefresh')
      await helper.waitValue(() => {
        return called
      }, true)
      await client.stop()
    })
  })

  describe('ExecuteCommandFeature', () => {
    it('should register command with middleware', async () => {
      let called = false
      let client = await startServer({}, {
        executeCommand: (cmd, args, next) => {
          called = true
          return next(cmd, args)
        }
      })
      await helper.waitValue(() => {
        return commands.has('test_command')
      }, true)
      let feature = client.getFeature(ExecuteCommandRequest.method)
      expect(feature).toBeDefined()
      feature.unregister('other_command')
      expect(feature.getState().kind).toBe('workspace')
      let res = await commands.executeCommand('test_command')
      expect(res).toEqual({ success: true })
      expect(called).toBe(true)
      let err
      let spy = jest.spyOn(client, 'handleFailedRequest').mockImplementation((_type, _token, error) => {
        err = error
      })
      await commands.executeCommand('other_command')
      spy.mockRestore()
      expect(err.message).toMatch(/not exists/)
      await client.sendNotification('unregister')
      await helper.waitValue(() => {
        return commands.has('test_command')
      }, false)
      await client.stop()
    })

    it('should register command without middleware', async () => {
      let client = await startServer({}, {})
      await helper.waitValue(() => {
        return commands.has('test_command')
      }, true)
      let res = await commands.executeCommand('test_command')
      expect(res).toEqual({ success: true })
      await client.stop()
    })
  })

  describe('DocumentSymbolFeature', () => {
    it('should provide documentSymbols without middleware', async () => {
      let client = await startServer({}, {})
      let feature = client.getFeature(DocumentSymbolRequest.method)
      expect(feature).toBeDefined()
      expect(feature.getState()).toBeDefined()
      let provider = feature.getProvider(textDocument)
      let res = await provider.provideDocumentSymbols(textDocument, token)
      expect(res).toEqual([])
      await client.stop()
    })

    it('should provide documentSymbols with middleware', async () => {
      let called = false
      let client = await startServer({ label: true }, {
        provideDocumentSymbols: (doc, token, next) => {
          called = true
          return next(doc, token)
        }
      })
      let feature = client.getFeature(DocumentSymbolRequest.method)
      let provider = feature.getProvider(textDocument)
      expect(provider.meta).toEqual({ label: 'test' })
      let res = await provider.provideDocumentSymbols(textDocument, token)
      expect(res).toEqual([])
      expect(called).toBe(true)
      await client.stop()
    })
  })

  describe('FileOperationFeature', () => {
    it('should use middleware for FileOperationFeature', async () => {
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
      await willRename.send({ files: [{ oldUri: URI.file(__dirname), newUri: URI.file(path.join(__dirname, 'x')) }], waitUntil: () => {} })
      let willDelete = client.getFeature(WillDeleteFilesRequest.method)
      await willDelete.send({ files: [URI.file('/x/y')], waitUntil: () => {} })
      await willDelete.send({ files: [], waitUntil: () => {} })
      await helper.waitValue(() => {
        return n
      }, 5)
      await client.stop()
    })

    it('should filter matches', async () => {
      let n = 0
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
      await createFeature.send({ files: [URI.file(os.tmpdir()), URI.file(__filename)] })
      await helper.waitValue(() => n, 2)
      await client.stop()
    })
  })

  describe('CompletionItemFeature', () => {
    it('should register multiple completion sources', async () => {
      let client = await startServer({}, {})
      let feature = client.getFeature(CompletionRequest.method)
      await helper.waitValue(() => {
        return feature.registrationLength
      }, 2)
      await client.stop()
    })
  })

  describe('WorkspaceFoldersFeature', () => {
    it('should register listeners', async () => {
      let client = await startServer({}, {})
      let feature = client.getFeature(DidChangeWorkspaceFoldersNotification.method)
      expect(feature).toBeDefined()
      let state = feature.getState() as any
      expect(state.registrations).toBe(true)
      feature.register({ id: '1', registerOptions: undefined })
      feature.unregister('b346648e-88e0-44e3-91e3-52fd6addb8c7')
      feature.unregister('2')
      await client.stop()
    })

    it('should handle WorkspaceFoldersRequest', async () => {
      let client = await startServer({ changeNotifications: true }, {})
      let folders = workspace.workspaceFolders
      expect(folders.length).toBe(0)
      await client.sendNotification('requestFolders')
      await helper.wait(10)
      let res = await client.sendRequest('getFolders')
      expect(res).toBeNull()
      workspace.workspaceFolderControl.addWorkspaceFolder(process.cwd(), true)
      await helper.wait(10)
      await client.stop()
    })

    it('should use workspaceFolders middleware', async () => {
      await workspace.loadFile(__filename)
      let folders = workspace.workspaceFolders
      expect(folders.length).toBe(1)
      let called = false
      let fn = jest.fn()
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
      await helper.waitValue(async () => {
        let res = await client.sendRequest('getFolders') as WorkspaceFolder[]
        return Array.isArray(res) && res.length == 1
      }, true)
      expect(called).toBe(true)
      workspace.workspaceFolderControl.addWorkspaceFolder(os.tmpdir(), true)
      expect(fn).toHaveBeenCalled()
      await client.stop()
    })

    it('should send folders event with middleware', async () => {
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
      expect(folders.length).toBe(0)
      await workspace.loadFile(__filename)
      await helper.waitValue(() => {
        return called
      }, true)
      await client.stop()
    })
  })

  describe('TextDocumentContentFeature', () => {
    it('should register static TextDocumentContent feature', async () => {
      let client = await startServer({ textDocumentContent: true }, {})
      let feature = client.getFeature(TextDocumentContentRequest.method)
      expect(feature.getState()['registrations']).toBe(true)
      let providers = feature.getProviders() as TextDocumentContentProviderShape[]
      let provider = providers[0]
      expect(provider.scheme).toBe('lsptest')
      let times = 0
      provider.provider.onDidChange(() => {
        times++
      })
      await client.sendNotification('fireDocumentContentRefresh')
      await helper.waitValue(() => times, 1)
      let uri = URI.parse('lsptest:///1')
      let spy = jest.spyOn(client, 'sendRequest').mockReturnValue(Promise.resolve(undefined))
      let res = await provider.provider.provideTextDocumentContent(uri, token)
      expect(res).toBeUndefined()
      spy.mockRestore()
      spy = jest.spyOn(client, 'sendRequest').mockReturnValue(Promise.resolve({ text: 'foo' }))
      res = await provider.provider.provideTextDocumentContent(uri, token)
      expect(res).toBe('foo')
      spy.mockRestore()
      spy = jest.spyOn(client, 'sendRequest').mockReturnValue(Promise.reject(new Error('myerror')))
      await expect(async () => {
        await provider.provider.provideTextDocumentContent(uri, token)
      }).rejects.toThrow(Error)
      spy.mockRestore()
      feature.unregister('b346648e-88e0-44e3-91e3-52fd6addb8c7')
      expect(feature.getState()['registrations']).toBe(false)
      await client.stop()
    })
  })
})
