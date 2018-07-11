import * as tslint from 'tslint' // this is a dev dependency only
import * as server from 'vscode-languageserver'

// Tslint fixers provided by the extensions

export interface TSLintAutofixEdit {
  range: [server.Position, server.Position]
  text: string
}

type FixResult = TSLintAutofixEdit | undefined

type FixCreator = (problem: tslint.RuleFailure, document: server.TextDocument) => FixResult

let fixes = new Map<string, FixCreator>()

let quoteFixCreator: FixCreator = (
  problem: tslint.RuleFailure,
  document: server.TextDocument
): FixResult => {
  // error message: ' should be "   or " should be '
  const wrongQuote = problem.getFailure()[0]
  const fixedQuote = wrongQuote === "'" ? '"' : "'"
  const contents = document
    .getText()
    .slice(
      problem.getStartPosition().getPosition() + 1,
      problem.getEndPosition().getPosition() - 1
    )
  return {
    range: convertProblemPositionsToRange(problem),
    text: `${fixedQuote}${contents}${fixedQuote}`
  }
}
fixes['quotemark'] = quoteFixCreator // tslint:disable-line

let whiteSpaceFixCreator: FixCreator = (
  problem: tslint.RuleFailure,
  document: server.TextDocument
): FixResult => {
  // error message: 'missing whitespace'
  if (problem.getFailure() !== 'missing whitespace') {
    return undefined
  }
  const contents = document
    .getText()
    .slice(
      problem.getStartPosition().getPosition(),
      problem.getEndPosition().getPosition()
    )
  return {
    range: convertProblemPositionsToRange(problem),
    text: ` ${contents}`
  }
}
fixes['whitespace'] = whiteSpaceFixCreator // tslint:disable-line

let tripleEqualsFixCreator: FixCreator = (
  problem: tslint.RuleFailure,
  _document: server.TextDocument
): FixResult => {
  // error message: '== should be ===' or '!= should be !=='
  let contents: string | undefined
  if (problem.getFailure() === '== should be ===') {
    contents = '==='
  } else if (problem.getFailure() === '!= should be !==') {
    contents = '!=='
  } else {
    return undefined
  }
  return {
    range: convertProblemPositionsToRange(problem),
    text: `${contents}`
  }
}
fixes['triple-equals'] = tripleEqualsFixCreator

let commentFormatFixCreator: FixCreator = (
  problem: tslint.RuleFailure,
  document: server.TextDocument
): FixResult => {
  // error messages:
  //   'comment must start with a space'
  //   'comment must start with lowercase letter'
  //   'comment must start with uppercase letter'
  function swapCase(contents: string, toLower: boolean): string {
    let i = contents.search(/\S/)
    if (i === -1) {
      return contents
    }
    let prefix = contents.substring(0, i)
    let swap = toLower ? contents[i].toLowerCase() : contents[i].toUpperCase()
    let suffix = contents.substring(i + 1)
    return `${prefix}${swap}${suffix}`
  }

  let replacement
  const contents = document
    .getText()
    .slice(
      problem.getStartPosition().getPosition(),
      problem.getEndPosition().getPosition()
    )

  switch (problem.getFailure()) {
    case 'comment must start with a space':
      replacement = ` ${contents}`
      break
    case 'comment must start with lowercase letter':
      replacement = swapCase(contents, true)
      break
    case 'comment must start with uppercase letter':
      replacement = swapCase(contents, false)
      break
    default:
      return undefined
  }
  return {
    range: convertProblemPositionsToRange(problem),
    text: replacement
  }
}

fixes['comment-format'] = commentFormatFixCreator

function convertToServerPosition(
  position: tslint.RuleFailurePosition
): server.Position {
  return {
    character: position.getLineAndCharacter().character,
    line: position.getLineAndCharacter().line
  }
}

function convertProblemPositionsToRange(
  problem: tslint.RuleFailure
): [server.Position, server.Position] {
  let startPosition = convertToServerPosition(problem.getStartPosition())
  let endPosition = convertToServerPosition(problem.getEndPosition())
  return [startPosition, endPosition]
}

export function createVscFixForRuleFailure(
  problem: tslint.RuleFailure,
  document: server.TextDocument
): TSLintAutofixEdit | undefined {
  let creator = fixes[problem.getRuleName()]
  if (creator) {
    return creator(problem, document)
  }
  return undefined
}
