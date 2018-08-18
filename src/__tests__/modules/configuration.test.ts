// test code of vscode folder
import Uri from 'vscode-uri'

describe('vscode uri', () => {

  test('uri => fsPath scheme', async () => {
    let f = 'file:///tmp/foo.ts'
    let uri = Uri.parse(f)
    expect(uri.scheme).toBe('file')
    expect(uri.toString()).toBe(f)
    expect(uri.fsPath).toBe(f.replace('file://', ''))
  })

  test('uri => uri.file', async () => {
    let f = '/tmp/foo.ts'
    let uri = Uri.file(f)
    expect(uri.toString()).toBe(`file://${f}`)
  })

})
