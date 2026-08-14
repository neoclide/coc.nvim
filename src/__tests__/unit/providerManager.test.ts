import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import '../../workspace'
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
