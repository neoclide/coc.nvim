import { score } from 'fuzzaldrin-plus'

describe('score', () => {

  function expectBigger(input: string, a: string, b: string): void {
    expect(score(a, input)).toBeGreaterThan(score(b, input))
  }

  it('should higher score for strict match #1', () => {
    expectBigger('re', 're', 'read')
    expectBigger('re', 're', 'rade')
    expectBigger('re', 're', 'Re')
    expectBigger('re', 're', 'Rae')
  })

  it('should higher score for strict match #2', () => {
    expectBigger('re', 'read', 'rce')
    expectBigger('re', 'read', 'Read')
    expectBigger('re', 'read', 'RecentEnd')
  })

  it('should higher score for word bundary match #3', () => {
    expectBigger('rs', 'recent_score', 'rtscore')
    expectBigger('rs', 'recentScore', 'rtscore')
    expectBigger('reR', 'recentRead', 'recentread')
  })
})
