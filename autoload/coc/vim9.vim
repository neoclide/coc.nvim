vim9script
scriptencoding utf-8

# From `coc#highlight#set(`:
#   type HighlightItem = [hlGroup, lnum, colStart, colEnd, combine?, start_incl?, end_incl?]
# From `src/core/highlights.ts`:
#   type HighlightItemDef = [string, number, number, number, number?, number?, number?]
# type HighlightItem = list<any>
# type HighlightItemList = list<HighlightItem>
# NOTE: Can't use type on vim9.0.0438

export def Set_highlights(bufnr: number, ns: number, highlights: list<any>, priority: number): void
  const maxCount = g:coc_highlight_maximum_count
  if len(highlights) > maxCount
    const changedtick = getbufvar(bufnr, 'changedtick', 0)
    Add_highlights_timer(bufnr, ns, highlights, priority, changedtick, maxCount)
  else
    Add_highlights(bufnr, ns, highlights, priority)
  endif
enddef

def Add_highlights_timer(bufnr: number, ns: number, highlights: list<any>, priority: number, changedtick: number, maxCount: number): void
  if getbufvar(bufnr, 'changedtick') != changedtick
    return
  endif
  const lengthOfHighlightItemList: number = len(highlights)
  var highlightItemList: list<any>
  var next: list<any>
  if maxCount < lengthOfHighlightItemList
    highlightItemList = highlights[ : maxCount - 1]
    next = highlights[maxCount : ]
  else
    highlightItemList = highlights[ : ]
    next = []
  endif
  Add_highlights(bufnr, ns, highlightItemList, priority)
  if len(next) > 0
    timer_start(10,  (_) => Add_highlights_timer(bufnr, ns, next, priority, changedtick, maxCount))
  endif
enddef

def Add_highlights(bufnr: number, ns: number, highlights: any, priority: number): void
  if bufwinnr(bufnr) == -1 # check buffer exists
    return
  endif
  for highlightItem in highlights
    const [ hlGroup: string, lnum: number, colStart: number, colEnd: number; _ ] = highlightItem
    const combine: number = get(highlightItem, 4, 1)
    const start_incl: number = get(highlightItem, 5, 0)
    const end_incl: number = get(highlightItem, 6, 0)
    const opts: dict<any> = {
      'priority': priority,
      'combine': combine,
      'start_incl': start_incl,
      'end_incl':  end_incl,
    }
    Add_highlight(bufnr, ns, hlGroup, lnum, colStart, colEnd, opts)
  endfor
enddef

export def Add_highlight(bufnr: number, src_id: number, hl_group: string, line: number, col_start: number, col_end: number, opts: dict<any> = {}): void
  if !hlexists(hl_group)
    execute $'highlight {hl_group} ctermfg=NONE'
  endif
  coc#api#funcs_buf_add_highlight(bufnr, src_id, hl_group, line, col_start, col_end, opts)
enddef

# From `src/core/highlights.ts`:
# type HighlightItemResult = [string, number, number, number, number?]
# type HighlightItemResult = list<any>

export def Get_highlights(bufnr: number, ns: number, start: number, end: number): list<any>
  const types: list<string> = coc#api#get_types(ns)
  if empty(types)
    return []
  endif

  final res: list<any> = []
  const endLnum: number = end == -1 ? -1 : end + 1
  for prop in prop_list(start + 1, {'bufnr': bufnr, 'types': types, 'end_lnum': endLnum})
    if prop['start'] == 0 || prop['end'] == 0
      # multi line textprop are not supported, simply ignore it
      continue
    endif
    const startCol: number = prop['col'] - 1
    const endCol: number = startCol + prop['length']
    add(res, [ substitute(prop['type'], '_\d\+$', '', ''), prop['lnum'] - 1, startCol, endCol, prop['id'] ])
  endfor
  return res
enddef

export def Del_markers(bufnr: number, ids: list<number>): void
  for id in ids
    prop_remove({'bufnr': bufnr, 'id': id})
  endfor
enddef

defcompile
