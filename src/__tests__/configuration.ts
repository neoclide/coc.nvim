// test code of vscode folder
import {Uri} from '../util'
import {parseContent} from '../configurations'

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

describe('configurations', () => {

  test('with dot', () => {
    let obj = `{
      "a": {
        "b.c": 1,
        "e": {
          "f": 1
        }
      },
      "x.y.z": true
    }`
    let res = parseContent(obj)
    expect(res).toEqual({
      a: {
        b: {
          c: 1
        },
        e: {
          f: 1
        }
      },
      x: {
        y: {
          z: true
        }
      }
    })
  })
})
