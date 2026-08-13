'use strict'
import * as proto from 'vscode-languageserver-protocol'
import { DidChangeWorkspaceFoldersParams, Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { BaseLanguageClient, MessageTransports } from '../../language-client/client'
import { WorkspaceFoldersFeature } from '../../language-client/workspaceFolders'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

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

function testEvent(t: TestContext, initial: MaybeFolders, then: MaybeFolders, added: proto.WorkspaceFolder[], removed: proto.WorkspaceFolder[]) {
  const client = new TestLanguageClient('foo', 'bar', {})

  let arg: any
  let spy = t.mock.method(client, 'sendNotification', (_p1: any, p2: any) => {
    arg = p2
    return Promise.resolve()
  })

  const feature = new TestWorkspaceFoldersFeature(client)

  feature.initializeWithFolders(initial)
  feature.sendInitialEvent(then)

  assert.ok(spy.mock.callCount() > 0)
  assert.strictEqual(spy.mock.callCount(), 1)
  const notification: DidChangeWorkspaceFoldersParams = arg
  assert.deepEqual(notification.event.added, added)
  assert.deepEqual(notification.event.removed, removed)
}

function testNoEvent(t: TestContext, initial: MaybeFolders, then: MaybeFolders) {
  const client = new TestLanguageClient('foo', 'bar', {})

  let spy = t.mock.method(client, 'sendNotification', () => {
    return Promise.resolve()
  })

  const feature = new TestWorkspaceFoldersFeature(client)

  feature.initializeWithFolders(initial)
  feature.sendInitialEvent(then)
  assert.strictEqual(spy.mock.callCount(), 0)
}

describe('Workspace Folder Feature Tests', () => {
  const removedFolder = { uri: URI.parse('file://xox/removed').toString(), name: 'removedName', index: 0 }
  const addedFolder = { uri: URI.parse('file://foo/added').toString(), name: 'addedName', index: 0 }
  const addedProto = { uri: 'file://foo/added', name: 'addedName' }
  const removedProto = { uri: 'file://xox/removed', name: 'removedName' }

  test('remove/add', async t => {
    assert.ok(!MessageTransports.is({}))
    testEvent(t, [removedFolder], [addedFolder], [addedProto], [removedProto])
  })

  test('remove', async t => {
    testEvent(t, [removedFolder], [], [], [removedProto])
  })

  test('remove2', async t => {
    testEvent(t, [removedFolder], undefined, [], [removedProto])
  })

  test('add', async t => {
    testEvent(t, [], [addedFolder], [addedProto], [])
  })

  test('add2', async t => {
    testEvent(t, undefined, [addedFolder], [addedProto], [])
  })

  test('noChange1', async t => {
    testNoEvent(t, [addedFolder, removedFolder], [addedFolder, removedFolder])
  })

  test('noChange2', async t => {
    testNoEvent(t, [], [])
  })

  test('noChange3', async t => {
    testNoEvent(t, undefined, undefined)
  })
})
