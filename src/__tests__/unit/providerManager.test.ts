import { CancellationToken, CancellationTokenSource, DocumentLink, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import '../../workspace'
import DocumentLinkManager from '../../provider/documentLinkManager'
import Manager from '../../provider/manager'
import type { ProviderItem } from '../../provider/manager'
import { CancellationError } from '../../util/errors'

class TestManager extends Manager<{ run: () => void }> {
  public runResults(
    results: PromiseSettledResult<void>[],
    name: string,
    items?: ReadonlyArray<ProviderItem<{ run: () => void }>>,
    token?: any
  ): void {
    this.handleResults(results, name, items, token)
  }
}

describe('provider manager results', () => {
  it('should log provider errors with extension attribution', () => {
    let manager = new TestManager()
    let items: ProviderItem<{ run: () => void }>[] = [
      { id: 'p1', selector: [], provider: { run: () => {} }, extension: 'plugin-a' }
    ]
    manager.runResults([{ status: 'rejected', reason: new Error('boom') }], 'provideTest', items)
  })

  it('should log provider errors without extension attribution', () => {
    let manager = new TestManager()
    manager.runResults([{ status: 'rejected', reason: new Error('boom') }], 'provideTest')
  })

  it('should rethrow cancellable errors while the token is active', () => {
    let manager = new TestManager()
    let tokenSource = new CancellationTokenSource()
    assert.throws(
      () => manager.runResults(
        [{ status: 'rejected', reason: new CancellationError() }],
        'provideTest',
        [],
        tokenSource.token
      ),
      CancellationError
    )
  })

  it('should ignore cancellable errors when the token is cancelled', () => {
    let manager = new TestManager()
    let tokenSource = new CancellationTokenSource()
    tokenSource.cancel()
    manager.runResults(
      [{ status: 'rejected', reason: new CancellationError() }],
      'provideTest',
      [],
      tokenSource.token
    )
  })
})

describe('document link manager', () => {
  it('should keep unresolved links after the provider is disposed', async () => {
    let manager = new DocumentLinkManager()
    let doc = TextDocument.create('file:///tmp/a.ts', 'typescript', 0, 'hello')
    let disposable = manager.register([{ language: '*' }], {
      provideDocumentLinks: () => [DocumentLink.create(Range.create(0, 0, 0, 5))],
      resolveDocumentLink: link => Object.assign(link, { target: 'http://example.com' })
    })
    let links = await manager.provideDocumentLinks(doc, CancellationToken.None)
    assert.ok(links)
    assert.strictEqual(links.length, 1)
    disposable.dispose()
    let resolved = await manager.resolveDocumentLink(links[0], CancellationToken.None)
    assert.strictEqual(resolved.target, undefined)
  })
})
