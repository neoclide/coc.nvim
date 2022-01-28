import { Range, TextEdit } from 'vscode-languageserver-protocol'

export function singleLineEdit(edit: TextEdit): boolean {
  let { range, newText } = edit
  return range.start.line == range.end.line && newText.indexOf('\n') == -1
}

export function getWellformedRange(range: Range): Range {
  const start = range.start
  const end = range.end
  if (start.line > end.line || (start.line === end.line && start.character > end.character)) {
    return { start: end, end: start }
  }
  return range
}

export function getWellformedEdit(textEdit: TextEdit) {
  const range = getWellformedRange(textEdit.range)
  if (range !== textEdit.range) {
    return { newText: textEdit.newText, range }
  }
  return textEdit
}

export function mergeSort<T>(data: T[], compare: (a: T, b: T) => number): T[] {
  if (data.length <= 1) {
    // sorted
    return data
  }
  const p = (data.length / 2) | 0
  const left = data.slice(0, p)
  const right = data.slice(p)
  mergeSort(left, compare)
  mergeSort(right, compare)
  let leftIdx = 0
  let rightIdx = 0
  let i = 0
  while (leftIdx < left.length && rightIdx < right.length) {
    let ret = compare(left[leftIdx], right[rightIdx])
    if (ret <= 0) {
      // smaller_equal -> take left to preserve order
      data[i++] = left[leftIdx++]
    } else {
      // greater -> take right
      data[i++] = right[rightIdx++]
    }
  }
  while (leftIdx < left.length) {
    data[i++] = left[leftIdx++]
  }
  while (rightIdx < right.length) {
    data[i++] = right[rightIdx++]
  }
  return data
}

