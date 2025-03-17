vim9script
# Called by `coc#highlight#set(`

# From `coc#highlight#set(`:
#   type HighlightItem = [hlGroup, lnum, colStart, colEnd, combine?, start_incl?, end_incl?]
# From `src/core/highlights.ts`:
#   type HighlightItemDef = [string, number, number, number, number?, number?, number?]
type HighlightItem = list<any>
type HighlightItemList = list<HighlightItem>

export def Add_highlights_timer(bufnr: number, ns: number, highlights: HighlightItemList, priority: number)
  const lengthOfHighlightItemList: number = len(highlights)
  const maximumCount: number = g:coc_highlight_maximum_count
  var highlightItemList: HighlightItemList
  var next: HighlightItemList
  if maximumCount < lengthOfHighlightItemList
    highlightItemList = highlights[ : maximumCount - 1]
    next = highlights[maximumCount : ]
  else
    highlightItemList = highlights[ : ]
    next = []
  endif
  Add_highlights(bufnr, ns, highlightItemList, priority)
  if len(next) > 0
    timer_start(30,  (_) => Add_highlights_timer(bufnr, ns, next, priority))
  endif
enddef

export def Add_highlights(bufnr: number, ns: number, highlights: HighlightItemList, priority: number)
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
    coc#highlight#add_highlight(bufnr, ns, hlGroup, lnum, colStart, colEnd, opts)
  endfor
enddef

export def Get_Highlights(bufnr: number, ns: number, start: number, end: number): list<any>
  final res: list<list<any>> = []
  const types: list<string> = coc#api#get_types(ns)
  if empty(types)
    return res
  endif

  const endLnum: number = end == -1 ? -1 : end + 1
  for prop in prop_list(start + 1, {'bufnr': bufnr, 'types': types, 'end_lnum': endLnum})
    if prop['start'] == 0 || prop['end'] == 0
      # multi line textprop are not supported, simply ignore it
      continue
    endif
    const startCol: number = prop['col'] - 1
    const endCol: number = startCol + prop['length']
    add(res, [ Prop_type_hlgroup(prop['type']), prop['lnum'] - 1, startCol, endCol, prop['id'] ])
  endfor
  return res
enddef

def Prop_type_hlgroup(type: string): string
  return substitute(type, '_\d\+$', '', '')
enddef
