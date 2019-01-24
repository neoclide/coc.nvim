import Mru from '../../model/mru'

describe('Mru', () => {

  it('should load items', async () => {
    let mru = new Mru('test')
    await mru.clean()
    let res = await mru.load()
    expect(res.length).toBe(0)
  })

  it('should add items', async () => {
    let mru = new Mru('test')
    await mru.add('a')
    await mru.add('b')
    let res = await mru.load()
    expect(res.length).toBe(2)
    await mru.clean()
  })

  it('should remove item', async () => {
    let mru = new Mru('test')
    await mru.add('a')
    await mru.remove('a')
    let res = await mru.load()
    expect(res.length).toBe(0)
    await mru.clean()
  })
})
