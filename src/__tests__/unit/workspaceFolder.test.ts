'use strict'
import * as assert from 'assert'
import type { MockTracker } from 'node:test'
import * as proto from 'vscode-languageserver-protocol'
import { DidChangeWorkspaceFoldersParams, Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { BaseLanguageClient, MessageTransports } from '../../language-client/client'
import { WorkspaceFoldersFeature } from '../../language-client/workspaceFolders'

class TestLanguageClient extends BaseLanguageClient {
  protected createMessageTransports(): Promise<MessageTransports> {
    throw new Error('Method not implemented.')
  }
  public onRequest(): Disposable {
    return {
      dispose: () => {}
    }
  }
}

type MaybeFolders = proto.WorkspaceFolder[] | undefined

class TestWorkspaceFoldersFeature extends WorkspaceFoldersFeature {
  public sendInitialEvent(currentWorkspaceFolders: MaybeFolders): void {
    super.sendInitialEvent(currentWorkspaceFolders)
  }

  public initializeWithFolders(currentWorkspaceFolders: MaybeFolders) {
    super.initializeWithFolders(currentWorkspaceFolders)
  }
}

function testEvent(mock: MockTracker, initial: MaybeFolders, then: MaybeFolders, added: proto.WorkspaceFolder[], removed: proto.WorkspaceFolder[]) {
  const client = new TestLanguageClient('foo', 'bar', {})

  let arg: any
  let spy = mock.method(client, 'sendNotification', (_p1, p2) => {
    arg = p2
    return Promise.resolve()
  })

  const feature = new TestWorkspaceFoldersFeature(client)

  feature.initializeWithFolders(initial)
  feature.sendInitialEvent(then)

  assert.ok((spy).mock.callCount() > 0)
  assert.strictEqual((spy).mock.callCount(), 1)
  const notification: DidChangeWorkspaceFoldersParams = arg
  assert.deepEqual(notification.event.added, added)
  assert.deepEqual(notification.event.removed, removed)
}

function testNoEvent(mock: MockTracker, initial: MaybeFolders, then: MaybeFolders) {
  const client = new TestLanguageClient('foo', 'bar', {})

  let spy = mock.method(client, 'sendNotification', () => {
    return Promise.resolve()
  })

  const feature = new TestWorkspaceFoldersFeature(client)

  feature.initializeWithFolders(initial)
  feature.sendInitialEvent(then)
  assert.strictEqual((spy).mock.callCount(), 0)
}

describe('Workspace Folder Feature Tests', () => {
  const removedFolder = { uri: URI.parse('file://xox/removed').toString(), name: 'removedName', index: 0 }
  const addedFolder = { uri: URI.parse('file://foo/added').toString(), name: 'addedName', index: 0 }
  const addedProto = { uri: 'file://foo/added', name: 'addedName' }
  const removedProto = { uri: 'file://xox/removed', name: 'removedName' }

  test('remove/add', async (t) => {
    assert.ok(!MessageTransports.is({}))
    testEvent(t.mock, [removedFolder], [addedFolder], [addedProto], [removedProto])
  })

  test('remove', async (t) => {
    testEvent(t.mock, [removedFolder], [], [], [removedProto])
  })

  test('remove2', async (t) => {
    testEvent(t.mock, [removedFolder], undefined, [], [removedProto])
  })

  test('add', async (t) => {
    testEvent(t.mock, [], [addedFolder], [addedProto], [])
  })

  test('add2', async (t) => {
    testEvent(t.mock, undefined, [addedFolder], [addedProto], [])
  })

  test('noChange1', async (t) => {
    testNoEvent(t.mock, [addedFolder, removedFolder], [addedFolder, removedFolder])
  })

  test('noChange2', async (t) => {
    testNoEvent(t.mock, [], [])
  })

  test('noChange3', async (t) => {
    testNoEvent(t.mock, undefined, undefined)
  })
})
