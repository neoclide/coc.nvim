'use strict'
import { byteLength, toText, upperFirst } from './string'

export interface AnsiItem {
  foreground?: string
  background?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  linkMarker?: number
  text: string
}

const foregroundColors = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'grey'
}

const backgroundColors = {
  40: 'black',
  41: 'red',
  42: 'green',
  43: 'yellow',
  44: 'blue',
  45: 'magenta',
  46: 'cyan',
  47: 'white'
}

const styles = {
  1: 'bold',
  3: 'italic',
  4: 'underline',
  9: 'strikethrough'
}

export interface AnsiHighlight {
  span: [number, number]
  hlGroup: string
}

export interface AnsiResult {
  line: string
  highlights: AnsiHighlight[]
}

export function parseAnsiHighlights(line: string, markdown = false, onLinkMarker?: (marker: number, byteOffset: number) => void): AnsiResult {
  let items = ansiparse(line)
  let highlights: AnsiHighlight[] = []
  let newLabel = ''
  let byteOffset = 0
  for (let item of items) {
    if (item.linkMarker != null) {
      onLinkMarker?.(item.linkMarker, byteOffset)
      continue
    }
    if (!item.text) continue
    let { foreground, background } = item
    let len = byteLength(item.text)
    let span: [number, number] = [byteOffset, byteOffset + len]
    if (foreground && background) {
      let hlGroup = `CocList${upperFirst(foreground)}${upperFirst(background)}`
      highlights.push({ span, hlGroup })
    } else if (foreground) {
      let hlGroup: string
      if (markdown) {
        if (foreground == 'yellow') {
          hlGroup = 'CocMarkdownCode'
        } else if (foreground == 'blue') {
          hlGroup = 'CocMarkdownLink'
        } else if (foreground == 'magenta') {
          hlGroup = 'CocMarkdownHeader'
        } else {
          hlGroup = `CocListFg${upperFirst(foreground)}`
        }
      } else {
        hlGroup = `CocListFg${upperFirst(foreground)}`
      }
      highlights.push({ span, hlGroup })
    } else if (background) {
      let hlGroup = `CocListBg${upperFirst(background)}`
      highlights.push({ span, hlGroup })
    }
    if (item.bold) {
      highlights.push({ span, hlGroup: 'CocBold' })
    } else if (item.italic) {
      highlights.push({ span, hlGroup: 'CocItalic' })
    } else if (item.underline) {
      highlights.push({ span, hlGroup: 'CocUnderline' })
    } else if (item.strikethrough) {
      highlights.push({ span, hlGroup: 'CocStrikeThrough' })
    }
    newLabel = newLabel + item.text
    byteOffset += len
  }
  return { line: newLabel, highlights }
}

export function ansiparse(str: string): AnsiItem[] {
  //
  // I'm terrible at writing parsers.
  //
  let matchingControl = null
  let matchingData = null
  let matchingText = ''
  let ansiState = []
  let result = []
  let state: Partial<AnsiItem> = {}
  let eraseChar

  //
  // General workflow for this thing is:
  // \033\[33mText
  // |     |  |
  // |     |  matchingText
  // |     matchingData
  // matchingControl
  //
  // \033\[K or \033\[m
  //
  // In further steps we hope it's all going to be fine. It usually is.
  //

  //
  // Erases a char from the output
  //
  eraseChar = () => {
    if (matchingText.length) {
      matchingText = matchingText.slice(0, matchingText.length - 1)
    }
    else if (result.length) {
      for (let index = result.length - 1; index >= 0; index--) {
        let text = result[index].text
        if (!text.length) continue
        if (text.length === 1) {
          //
          // A result bit was fully deleted, remove it to simplify the final output
          //
          result.splice(index, 1)
        }
        else {
          result[index].text = text.slice(0, text.length - 1)
        }
        break
      }
    }
  }

  for (let i = 0; i < str.length; i++) {
    if (matchingControl != null) {
      if (matchingControl == '\x1b' && str[i] == '[') {
        //
        // We've matched full control code. Lets start matching formatting data.
        //

        //
        // "emit" matched text with correct state
        //
        if (matchingText) {
          state.text = matchingText
          result.push(state)
          state = {}
          matchingText = ''
        }
        if (matchingText == '' && (str[i + 1] == 'm' || str[i + 1] == 'K')) {
          if (state.foreground || state.background) {
            state.text = ''
            result.push(state)
          }
          state = {}
        }

        matchingControl = null
        matchingData = ''
      } else {
        //
        // We failed to match anything - most likely a bad control code. We
        // go back to matching regular strings.
        //
        matchingText += matchingControl + str[i]
        matchingControl = null
      }
      continue
    } else if (matchingData != null) {
      if (str[i] == ';') {
        //
        // `;` separates many formatting codes, for example: `\033[33;43m`
        // means that both `33` and `43` should be applied.
        //
        // TODO: this can be simplified by modifying state here.
        //
        ansiState.push(matchingData)
        matchingData = ''
      } else if (str[i] == 'm' || str[i] == 'K') {
        //
        // `m` finished whole formatting code. We can proceed to matching
        // formatted text.
        //
        ansiState.push(matchingData)
        matchingData = null
        matchingText = ''

        if (str[i] == 'm' && ansiState.length == 2 && ansiState[0] == '1000' && /^\d+$/.test(ansiState[1])) {
          let marker = Number(ansiState[1])
          if (Number.isSafeInteger(marker)) result.push({ text: '', linkMarker: marker })
        }

        //
        // Convert matched formatting data into user-friendly state object.
        //
        ansiState.forEach(ansiCode => {
          if (foregroundColors[ansiCode]) {
            state.foreground = foregroundColors[ansiCode]
          } else if (backgroundColors[ansiCode]) {
            state.background = backgroundColors[ansiCode]
          } else if (ansiCode == 39) {
            delete state.foreground
          } else if (ansiCode == 49) {
            delete state.background
          } else if (styles[ansiCode]) {
            state[styles[ansiCode]] = true
          } else if (ansiCode == 22) {
            state.bold = false
          } else if (ansiCode == 23) {
            state.italic = false
          } else if (ansiCode == 24) {
            state.underline = false
          } else if (ansiCode == 29) {
            state.strikethrough = false
          }
        })
        ansiState = []
      }
      else {
        matchingData += str[i]
      }
      continue
    }

    if (str[i] == '\x1b') {
      matchingControl = str[i]
    } else if (str[i] == '\u0008') {
      eraseChar()
    } else {
      matchingText += str[i]
    }
  }

  if (matchingText) {
    state.text = matchingText + toText(matchingControl)
    result.push(state)
  }
  return result
}

export function stripAnsiColoring(str?: string): string {
  // eslint-disable-next-line
  const ansiColorCodeRegex = /\u001b\[[0-9;]*m/g
  return str.replace(ansiColorCodeRegex, '')
}
