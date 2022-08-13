'use strict'

import * as assert from 'assert'
import { WorkspaceFoldersFeature } from '../../language-client/workspaceFolders'
import { BaseLanguageClient, MessageTransports } from '../../language-client/client'
import { Disposable, DidChangeWorkspaceFoldersParams } from 'vscode-languageserver-protocol'
import * as proto from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'

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

function testEvent(initial: MaybeFolders, then: MaybeFolders, added: proto.WorkspaceFolder[], removed: proto.WorkspaceFolder[]) {
  const client = new TestLanguageClient('foo', 'bar', {})

  let arg: any
  let spy = jest.spyOn(client, 'sendNotification').mockImplementation((_p1, p2) => {
    arg = p2
    return Promise.resolve()
  })

  const feature = new TestWorkspaceFoldersFeature(client)

  feature.initializeWithFolders(initial)
  feature.sendInitialEvent(then)

  expect(spy).toHaveBeenCalled()
  expect(spy).toHaveBeenCalledTimes(1)
  const notification: DidChangeWorkspaceFoldersParams = arg
  assert.deepEqual(notification.event.added, added)
  assert.deepEqual(notification.event.removed, removed)
}

function testNoEvent(initial: MaybeFolders, then: MaybeFolders) {
  const client = new TestLanguageClient('foo', 'bar', {})

  let spy = jest.spyOn(client, 'sendNotification').mockImplementation(() => {
    return Promise.resolve()
  })

  const feature = new TestWorkspaceFoldersFeature(client)

  feature.initializeWithFolders(initial)
  feature.sendInitialEvent(then)
  expect(spy).toHaveBeenCalledTimes(0)
}

describe('Workspace Folder Feature Tests', () => {
  const removedFolder = { uri: URI.parse('file://xox/removed').toString(), name: 'removedName', index: 0 }
  const addedFolder = { uri: URI.parse('file://foo/added').toString(), name: 'addedName', index: 0 }
  const addedProto = { uri: 'file://foo/added', name: 'addedName' }
  const removedProto = { uri: 'file://xox/removed', name: 'removedName' }

  test('remove/add', async () => {
    assert.ok(!MessageTransports.is({}))
    testEvent([removedFolder], [addedFolder], [addedProto], [removedProto])
  })

  test('remove', async () => {
    testEvent([removedFolder], [], [], [removedProto])
  })

  test('remove2', async () => {
    testEvent([removedFolder], undefined, [], [removedProto])
  })

  test('add', async () => {
    testEvent([], [addedFolder], [addedProto], [])
  })

  test('add2', async () => {
    testEvent(undefined, [addedFolder], [addedProto], [])
  })

  test('noChange1', async () => {
    testNoEvent([addedFolder, removedFolder], [addedFolder, removedFolder])
  })

  test('noChange2', async () => {
    testNoEvent([], [])
  })

  test('noChange3', async () => {
    testNoEvent(undefined, undefined)
  })
})
