import { PathFormatting } from '../diagnostic/manager'
import { ListItem } from '../types'

export interface UnformattedListItem extends Omit<ListItem, 'label'> {
  label: string[]
}

export function formatListItems(align: boolean, list: UnformattedListItem[]): ListItem[] {
  if (list.length === 0) {
    return []
  }

  let processedList: ListItem[] = []

  if (align) {
    const maxWidths = Array(Math.min(...list.map(item => item.label.length))).fill(0)
    for (let item of list) {
      for (let i = 0; i < maxWidths.length; i++) {
        maxWidths[i] = Math.max(maxWidths[i], item.label[i].length)
      }
    }
    processedList = list
      .map(item => ({
        ...item,
        label: item.label
          .map((element, idx) => element.padEnd(maxWidths[idx]))
          .join("\t")
      }))
  } else {
    processedList = list.map(item => ({...item, label: item.label.join("\t")}))
  }
  return processedList
}

export function formatPath(format: PathFormatting, path: string): string {
  if (format === "hidden") {
    return ""
  } else if (format === "full") {
    return path
  } else if (format === "short") {
    const segments = path.split("/")
    if (segments.length < 2) {
      return path
    }
    const shortenedInit = segments
      .slice(0, segments.length - 2)
      .filter(seg => seg.length > 0)
      .map(seg => seg[0])
    return [...shortenedInit, segments[segments.length - 1]].join("/")
  } else {
    const segments = path.split("/")
    return segments[segments.length - 1] ?? ""
  }
}
