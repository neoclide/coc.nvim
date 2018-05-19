import IpcService from '../model/ipcService'
import {wait} from '../util/index'
import path = require('path')

describe('child model test', () => {
  let ch:IpcService

  beforeAll(() => {
    let file = path.resolve(__dirname, '../../bin/tern.js')
    ch = new IpcService(file)
    ch.start()
  })

  afterAll(() => {
    ch.stop()
  })

  test('tern server works', async () => {
    let result = ''
    let res = await ch.request({
      action: 'complete',
      line: 2,
      col: 'arr.p'.length,
      filename: 'example.js',
      content: '\nlet arr = [];\narr.p',
    })
    expect(res.length).toBeGreaterThan(1)
  })
})
