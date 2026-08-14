import { URI } from 'vscode-uri'
import { WorkspaceFolder } from 'vscode-languageserver-types'
import RelativePattern from '../../model/relativePattern'

describe('RelativePattern', () => {
  it('should build from a string base', () => {
    let pattern = new RelativePattern('/tmp/base', '**/*.ts')
    assert.strictEqual(pattern.pattern, '**/*.ts')
    assert.strictEqual(pattern.baseUri.toString(), URI.file('/tmp/base').toString())
  })

  it('should build from a URI base', () => {
    let uri = URI.file('/tmp/base')
    let pattern = new RelativePattern(uri, '*.js')
    assert.strictEqual(pattern.baseUri.toString(), uri.toString())
    assert.strictEqual(pattern.pattern, '*.js')
  })

  it('should build from a workspace folder', () => {
    let folder: WorkspaceFolder = {
      uri: 'file:///tmp/ws',
      name: 'ws'
    }
    let pattern = new RelativePattern(folder, 'src/*.ts')
    assert.strictEqual(pattern.baseUri.toString(), URI.parse('file:///tmp/ws').toString())
    assert.strictEqual(pattern.pattern, 'src/*.ts')
  })

  it('should serialize to JSON', () => {
    let pattern = new RelativePattern('/tmp/base', '*.ts')
    assert.deepStrictEqual(pattern.toJSON(), {
      pattern: '*.ts',
      baseUri: URI.file('/tmp/base').toJSON()
    })
  })

  it('should reject invalid base', () => {
    assert.throws(() => new RelativePattern(undefined as any, '*.ts'), /Illegal argument/)
    assert.throws(() => new RelativePattern({} as any, '*.ts'), /Illegal argument/)
  })

  it('should reject invalid pattern', () => {
    assert.throws(() => new RelativePattern('/tmp/base', undefined as any), /Illegal argument/)
    assert.throws(() => new RelativePattern('/tmp/base', 1 as any), /Illegal argument/)
  })
})
