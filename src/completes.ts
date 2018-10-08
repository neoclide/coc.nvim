import Complete from './model/complete'
import { CompleteOption, ISource, RecentScore, VimCompleteItem } from './types'
import { fuzzyMatch, getCharCodes } from './util/fuzzy'
import workspace from './workspace'
const logger = require('./util/logger')('completes')

export class Completes {
  public complete: Complete | null
  public recentScores: RecentScore
  private completeItems: VimCompleteItem[] | null

  constructor() {
    this.complete = null
    this.recentScores = {}
  }

  public addRecent(word: string): void {
    if (!word.length || !this.complete) return
    let { input } = this.complete.option
    if (!input.length) return
    let key = `${input.slice(0, 1)}|${word}`
    let val = this.recentScores[key]
    if (!val) {
      this.recentScores[key] = 0.01
    } else {
      this.recentScores[key] = Math.min(val + 0.01, 0.1)
    }
  }

  public async doComplete(
    sources: ISource[],
    option: CompleteOption): Promise<VimCompleteItem[]> {
    let config = workspace.getConfiguration('coc.preferences')
    let complete = new Complete(option, this.recentScores, config)
    this.complete = complete
    let items = await complete.doComplete(sources)
    this.completeItems = items || []
    return items
  }

  public filterCompleteItems(input: string): VimCompleteItem[] {
    let { complete } = this
    if (!complete || !complete.results) return []
    this.option.input = input
    let items = complete.filterResults(input, true)
    this.completeItems = items || []
    return items
  }

  // TODO this is incorrect sometimes
  public getCompleteItem(word: string): VimCompleteItem | null {
    let { completeItems } = this
    if (!completeItems) return null
    return completeItems.find(o => o.word == word)
  }

  public reset(): void {
    // noop
  }

  public get option(): CompleteOption | null {
    let { complete } = this
    if (!complete) return null
    return complete.option
  }

  public hasMatch(search: string): boolean {
    let { complete } = this
    if (!complete || complete.results == null) return false
    let { results } = complete
    let codes = getCharCodes(search)
    for (let res of results) {
      let { items } = res
      for (let o of items) {
        let s = o.filterText || o.word
        if (fuzzyMatch(codes, s)) {
          return true
        }
      }
    }
    return false
  }
}

export default new Completes()
