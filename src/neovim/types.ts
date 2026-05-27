export interface Position {
  /**
   * Line position in a document (zero-based).
   * If a line number is greater than the number of lines in a document, it defaults back to the number of lines in the document.
   * If a line number is negative, it defaults to 0.
   */
  line: number
  /**
   * Character offset on a line in a document (zero-based). Assuming that the line is
   * represented as a string, the `character` value represents the gap between the
   * `character` and `character + 1`.
   *
   * If the character value is greater than the line length it defaults back to the
   * line length.
   * If a line number is negative, it defaults to 0.
   */
  character: number
}

export interface Range {
  /**
   * The range's start position
   */
  start: Position
  /**
   * The range's end position.
   */
  end: Position
}

export type Parameters = [string, string]

export interface FunctionInfo {
  parameters: Parameters[]
  method: boolean
  return_type: string
  name: string
  since: number
}

export interface UiEventInfo {
  parameters: Parameters[]
  name: string
  since: number
}

export interface ApiInfo {
  version: {
    major: number
    minor: number
    patch: number
    api_level: number
    api_compatible: number
    api_prerelease: number
  }
  functions: FunctionInfo[]
  ui_events: UiEventInfo[]
  ui_options: string[]
  error_types: object
  types: object
}

export type VimValue =
  | number
  | boolean
  | string
  | number[]
  | { [key: string]: any }

export type AtomicResult = [VimValue[], null | [number, string, string]]
