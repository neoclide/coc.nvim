import { PathFormatting } from '../diagnostic/manager'

export function alignElements(elements: string[][]): string[] {
  if (elements.length === 0 || !elements.every(elem => elem.length === elements[0].length)) {
    return []
  }
  const lengths = elements.map(item => item.map(x => x.length))

  const maxLengths = []
  for (let elementIdx = 0; elementIdx < elements[0].length; elementIdx++) {
    maxLengths.push(Math.max(...lengths.map(x => x[elementIdx])))
  }
  return elements
    .map(item => item.map((element, elementIdx) => element.padEnd(maxLengths[elementIdx])))
    .map(line => line.join("\t"))
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
