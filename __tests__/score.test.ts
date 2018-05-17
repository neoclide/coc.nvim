import {score} from 'fuzzaldrin'

describe('score test', () => {
  it('should have higher score if case match', () => {
    let one = score('Increment', 'incre')
    let two = score('increment', 'incre')
    expect(two > one).toBeTruthy
  })
})
