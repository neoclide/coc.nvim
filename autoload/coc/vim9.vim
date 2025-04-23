vim9script
scriptencoding utf-8

# Check if lines synchronized as expected
export def Check_sha256(bufnr: number, expected: string): bool
  if !exists('*sha256')
    return true
  endif
  return getbufline(bufnr, 1, '$')->join("\n")->sha256() ==# expected
enddef

# From `coc#highlight#set(`:
#   type HighlightItem = [hlGroup, lnum, colStart, colEnd, combine?, start_incl?, end_incl?]
# From `src/core/highlights.ts`:
#   type HighlightItemDef = [string, number, number, number, number?, number?, number?]
# type HighlightItem = list<any>
# type HighlightItemList = list<HighlightItem>
# NOTE: Can't use type on vim9.0.0438
export def Set_highlights(bufnr: number, ns: number, highlights: list<any>, priority: number): void
  const maxCount = get(g:, 'coc_highlight_maximum_count', 500)
  const changedtick = getbufvar(bufnr, 'changedtick', 0)
  Add_highlights_timer(bufnr, ns, highlights, priority, changedtick, maxCount)
enddef

def Add_highlights_timer(bufnr: number, ns: number, highlights: list<any>, priority: number, changedtick: number, maxCount: number): void
  if !bufloaded(bufnr) || getbufvar(bufnr, 'changedtick', 0) != changedtick
    return
  endif
  if len(highlights) > maxCount
    const hls = highlights[ : maxCount - 1]
    const next = highlights[maxCount : ]
    Add_highlights(bufnr, ns, hls, priority)
    timer_start(10,  (_) => Add_highlights_timer(bufnr, ns, next, priority, changedtick, maxCount))
  else
    Add_highlights(bufnr, ns, highlights, priority)
  endif
enddef

def Add_highlights(bufnr: number, ns: number, highlights: any, priority: number): void
  final types = coc#api#GetNamespaceTypes(ns)->copy()
  for highlightItem in highlights
    const [ hlGroup: string, lnum: number, colStart: number, colEnd: number; _ ] = highlightItem
    const type: string = $'{hlGroup}_{ns}'
    const propId: number = coc#api#GeneratePropId(bufnr)
    if index(types, type) == -1
      const opts: dict<any> = {
        'priority': priority,
        'hl_mode': get(highlightItem, 4, 1) ? 'combine' : 'override',
        'start_incl': get(highlightItem, 5, 0),
        'end_incl': get(highlightItem, 6, 0),
      }
      coc#api#CreateType(ns, hlGroup, opts)
      add(types, type)
    endif
    try
      prop_add(lnum + 1, colStart + 1, {'bufnr': bufnr, 'type': type, 'id': propId, 'end_col': colEnd + 1})
    catch /^Vim\%((\a\+)\)\=:\(E967\|E964\)/
      # ignore 967
    endtry
  endfor
enddef

# From `src/core/highlights.ts`:
# type HighlightItemResult = [string, number, number, number, number?]
# type HighlightItemResult = list<any>
export def Get_highlights(bufnr: number, key: string, start: number, end: number): list<any>
  if !bufloaded(bufnr)
    return []
  endif
  const ns = coc#api#Create_namespace($'coc-{key}')
  const types: list<string> = coc#api#GetNamespaceTypes(ns)
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

# Can't use strdisplaywidth as it doesn't support bufnr
def Calc_padding_size(bufnr: number, indent: string): number
  const tabSize: number = getbufvar(bufnr, '&shiftwidth') ?? getbufvar(bufnr, '&tabstop', 8)
  var padding: number = 0
  for character in indent
    if character == "\t"
      padding += tabSize - (padding % tabSize)
    else
      padding += 1
    endif
  endfor
  return padding
enddef

def Add_vtext_item(bufnr: number, ns: number, opts: dict<any>, pre: string, priority: number): void
  var propColumn: number = get(opts, 'col', 0)
  const align = get(opts, 'text_align', 'after')
  const line = opts.line
  const blocks = opts.blocks
  var blockList: list<list<string>> = blocks
  if !empty(blocks) && (align ==# 'above' || align ==# 'below')
    # only first highlight can be used
    const highlightGroup: string = blocks[0][1]
    const text: string = blocks->mapnew((_, block: list<string>): string => block[0])->join('')
    blockList = [[text, highlightGroup]]
    propColumn = 0
  endif
  var first: bool = true
  final base: dict<any> = { 'priority': priority }
  if propColumn == 0
    base.text_align = align
  endif
  if has_key(opts, 'text_wrap')
    base.text_wrap = opts.text_wrap
  endif
  for [text, highlightGroup] in blockList
    const type: string = coc#api#CreateType(ns, highlightGroup, opts)
    final propOpts: dict<any> = extend({ 'text': text, 'type': type, 'bufnr': bufnr }, base)
    if first
      # add a whitespace, same as neovim.
      if propColumn == 0 && align ==# 'after'
        propOpts.text_padding_left = 1
      elseif !empty(pre)
        propOpts['text_padding_left'] = Calc_padding_size(bufnr, pre)
      endif
    endif
    prop_add(line + 1, propColumn, propOpts)
    first = false
  endfor
enddef

export def Add_vtext(bufnr: number, ns: number, line: number, blocks: list<list<string>>, opts: dict<any>): void
  var propIndent: string = ''
  if get(opts, 'indent', false)
    propIndent = matchstr(get(getbufline(bufnr, line + 1), 0, ''), '^\s\+')
  endif
  final conf = {'line': line, 'blocks': blocks}
  Add_vtext_item(bufnr, ns, extend(conf, opts), propIndent, get(opts, 'priority', 0))
enddef

def Add_vtext_items(bufnr: number, ns: number, items: list<any>, indent: bool, priority: number): void
  const length = len(items)
  if length > 0
    var buflines: list<string> = []
    var start = 0
    var propIndent: string = ''
    if indent
      start = items[0].line
      const endLine = items[length - 1].line
      buflines = getbufline(bufnr, start + 1, endLine + 1)
    endif
    for item in items
      if indent
        propIndent = matchstr(buflines[item.line - start], '^\s\+')
      endif
      Add_vtext_item(bufnr, ns, item, propIndent, priority)
    endfor
  endif
enddef

def Add_vtexts_timer(bufnr: number, ns: number, items: list<any>, indent: bool,
            priority: number, changedtick: number, maxCount: number): void
  if !bufloaded(bufnr) || getbufvar(bufnr, 'changedtick', 0) != changedtick
    return
  endif
  if len(items) > maxCount
    const hls = items[ : maxCount - 1]
    const next = items[maxCount : ]
    Add_vtext_items(bufnr, ns, hls, indent, priority)
    timer_start(10,  (_) => Add_vtexts_timer(bufnr, ns, next, indent, priority, changedtick, maxCount))
  else
    Add_vtext_items(bufnr, ns, items, indent, priority)
  endif
enddef

export def Set_virtual_texts(bufnr: number, ns: number, items: list<any>, indent: bool, priority: number): void
  const maxCount = get(g:, 'coc_highlight_maximum_count', 500)
  const changedtick = getbufvar(bufnr, 'changedtick', 0)
  Add_vtexts_timer(bufnr, ns, items, indent, priority, changedtick, maxCount)
enddef

defcompile
