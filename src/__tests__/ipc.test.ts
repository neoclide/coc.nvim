import IpcService from '../model/ipcService'
import {wait} from '../util/index'
import {ROOT} from '../constant'
import path = require('path')

describe('child model test', () => {
  let ch:IpcService

  beforeAll(() => {
    const file = path.resolve(__dirname, '../../bin/tern.js')
    const ternRoot = path.join(ROOT, 'node_modules/tern')
    ch = new IpcService(file, process.cwd(), [], [ternRoot])
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
