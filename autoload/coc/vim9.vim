vim9script
scriptencoding utf-8

const default_priority = 1024
const priorities = {
  'CocListSearch': 2048,
  'CocSearch': 2048,
}
const diagnostic_hlgroups = ['CocUnusedHighlight', 'CocDeprecatedHighlight', 'CocHintHighlight', 'CocInfoHighlight', 'CocWarningHighlight', 'CocErrorHighlight']
const maxCount = get(g:, 'coc_highlight_maximum_count', 500)
const maxTimePerBatchMs = 16
var maxEditCount = get(g:, 'coc_edits_maximum_count', 200)
var saved_event_ignore: string = ''

def Is_timeout(start_time: list<any>, max: number): bool
  return (start_time->reltime()->reltimefloat()) * 1000 > max
enddef

# Some hlGroups have higher priorities.
def Get_priority(hlGroup: string, priority: any): number
  if has_key(priorities, hlGroup)
    return priorities[hlGroup]
  endif
  if type(priority) != v:t_number
    return default_priority
  endif
  const idx = index(diagnostic_hlgroups, hlGroup)
  if idx != -1
    return priority + idx
  endif
  return priority
enddef

def Convert_item(item: any): list<any>
  if type(item) == v:t_list
    return item
  endif
  # hlGroup, lnum, colStart, colEnd, combine, start_incl, end_incl
  const combine = has_key(priorities, item.hlGroup) ? 1 : get(item, 'combine', 0)
  const start_incl = get(item, 'start_incl', 0)
  const end_incl = get(item, 'end_incl', 0)
  return [item.hlGroup, item.lnum, item.colStart, item.colEnd, combine, start_incl, end_incl]
enddef

# Check if lines synchronized as expected
export def Check_sha256(bufnr: number, expected: string): bool
  if !exists('*sha256')
    return true
  endif
  return getbufline(bufnr, 1, '$')->join("\n")->sha256() ==# expected
enddef

def Create_namespace(key: any): number
  if type(key) == v:t_number
    if key == -1
      return coc#api#Create_namespace('anonymous')
    endif
    return key
  endif
  if type(key) != v:t_string
    throw 'Expect number or string for namespace key.'
  endif
  return coc#api#Create_namespace($'coc-{key}')
enddef

export def Clear_highlights(id: number, key: any, start_line: number = 0, end_line: number = -1): void
  const buf = id == 0 ? bufnr('%') : id
  if bufloaded(buf)
    const ns = Create_namespace(key)
    coc#api#Buf_clear_namespace(buf, ns, start_line, end_line)
  endif
enddef

export def Add_highlight(id: number, key: any, hl_group: string, line: number, col_start: number, col_end: number, opts: dict<any> = {}): void
  const buf = id == 0 ? bufnr('%') : id
  if bufloaded(buf)
    const ns = Create_namespace(key)
    coc#api#Buf_add_highlight1(buf, ns, hl_group, line, col_start, col_end, opts)
  endif
enddef

export def Clear_all(): void
  const namespaces = coc#api#Get_namespaces()
  const bufnrs = getbufinfo({'bufloaded': 1})->mapnew((_, o: dict<any>): number => o.bufnr)
  for ns in values(namespaces)
    for bufnr in bufnrs
      coc#api#Buf_clear_namespace(bufnr, ns, 0, -1)
    endfor
  endfor
enddef

# From `coc#highlight#set(`:
#   type HighlightItem = [hlGroup, lnum, colStart, colEnd, combine?, start_incl?, end_incl?]
# From `src/core/highlights.ts`:
#   type HighlightItemDef = [string, number, number, number, number?, number?, number?]
# type HighlightItem = list<any>
# type HighlightItemList = list<HighlightItem>
# NOTE: Can't use type on vim9.0.0438
export def Set_highlights(bufnr: number, key: any, highlights: list<any>, priority: any = null): void
  if bufloaded(bufnr)
    const changedtick = getbufvar(bufnr, 'changedtick', 0)
    const ns = Create_namespace(key)
    Add_highlights_timer(bufnr, ns, highlights, priority, changedtick)
  endif
enddef

def Add_highlights_timer(bufnr: number, ns: number, highlights: list<any>, priority: any, changedtick: number): void
  if !bufloaded(bufnr) || getbufvar(bufnr, 'changedtick', 0) != changedtick
    return
  endif
  const total = len(highlights)
  const start_time = reltime()
  var end_idx = 0
  for i in range(0, total - 1, maxCount)
    end_idx = i + maxCount - 1
    const hls = highlights[i : end_idx]
    Add_highlights(bufnr, ns, hls, priority)
    if Is_timeout(start_time, maxTimePerBatchMs)
      break
    endif
  endfor
  if end_idx < total - 1
    const next = highlights[end_idx + 1 : ]
    timer_start(10,  (_) => Add_highlights_timer(bufnr, ns, next, priority, changedtick))
  endif
enddef

def Add_highlights(bufnr: number, ns: number, highlights: list<any>, priority: any): void
  final types = coc#api#GetNamespaceTypes(ns)->copy()
  for highlightItem in highlights
    const item = Convert_item(highlightItem)
    var [ hlGroup: string, lnum: number, colStart: number, colEnd: number; _ ] = item
    if colEnd == -1
      colEnd = getbufline(bufnr, lnum + 1)->get(0, '')->strlen()
    endif
    const type: string = $'{hlGroup}_{ns}'
    if index(types, type) == -1
      const opts: dict<any> = {
        'priority': Get_priority(hlGroup, priority),
        'hl_mode': get(item, 4, 1) ? 'combine' : 'override',
        'start_incl': get(item, 5, 0),
        'end_incl': get(item, 6, 0),
      }
      coc#api#CreateType(ns, hlGroup, opts)
      add(types, type)
    endif
    const propId: number = coc#api#GeneratePropId(bufnr)
    try
      prop_add(lnum + 1, colStart + 1, {'bufnr': bufnr, 'type': type, 'id': propId, 'end_col': colEnd + 1})
    catch /^Vim\%((\a\+)\)\=:\(E967\|E964\)/
      # ignore 967
    endtry
  endfor
enddef

export def Update_highlights(id: number, key: string, highlights: list<any>, start: number = 0, end: number = -1, priority: any = null, changedtick: any = null): void
  const bufnr = id == 0 ? bufnr('%') : id
  if bufloaded(bufnr)
    const tick = getbufvar(bufnr, 'changedtick')
    if type(changedtick) == v:t_number && changedtick != tick
      return
    endif
    const ns = Create_namespace(key)
    coc#api#Buf_clear_namespace(bufnr, ns, start, end)
    Add_highlights_timer(bufnr, ns, highlights, priority, tick)
  endif
enddef

# key could be -1 or string or number
export def Buffer_update(bufnr: number, key: any, highlights: list<any>, priority: any = null, changedtick: any = null): void
  if bufloaded(bufnr)
    const ns = Create_namespace(key)
    coc#api#Buf_clear_namespace(bufnr, ns, 0, -1)
    if empty(highlights)
      return
    endif
    const tick = getbufvar(bufnr, 'changedtick', 0)
    if type(changedtick) == v:t_number && tick != changedtick
      return
    endif
    # highlight current region first
    const winid = bufwinid(bufnr)
    if winid == -1
      Add_highlights_timer(bufnr, ns, highlights, priority, tick)
    else
      const info = getwininfo(winid)->get(0, {})
      const topline = info.topline
      const botline = info.botline
      if topline <= 5
        Add_highlights_timer(bufnr, ns, highlights, priority, tick)
      else
        final curr_hls = []
        final other_hls = []
        for hl in highlights
          const lnum = type(hl) == v:t_list ? hl[1] + 1 : hl.lnum + 1
          if lnum >= topline && lnum <= botline
            add(curr_hls, hl)
          else
            add(other_hls, hl)
          endif
        endfor
        const hls = extend(curr_hls, other_hls)
        Add_highlights_timer(bufnr, ns, hls, priority, tick)
      endif
    endif
  endif
enddef

export def Highlight_ranges(id: number, key: any, hlGroup: string, ranges: list<any>, opts: dict<any> = {}): void
  const bufnr = id == 0 ? bufnr('%') : id
  if bufloaded(bufnr)
    final highlights: list<any> = []
    if get(opts, 'clear', false) == true
      const ns = Create_namespace(key)
      coc#api#Buf_clear_namespace(bufnr, ns, 0, -1)
    endif
    for range in ranges
      const start_pos = range.start
      const end_pos = range.end
      const lines = getbufline(bufnr, start_pos.line + 1, end_pos.line + 1)
      for index in range(start_pos.line, end_pos.line)
        const line = get(lines, index - start_pos.line, '')
        if len(line) == 0
          continue
        endif
        const colStart = index == start_pos.line ? coc#text#Byte_index(line, start_pos.character) : 0
        const colEnd = index == end_pos.line ? coc#text#Byte_index(line, end_pos.character) : strlen(line)
        if colStart >= colEnd
          continue
        endif
        const combine = get(opts, 'combine', false) ? 1 : 0
        const start_incl = get(opts, 'start_incl', false) ? 1 : 0
        const end_incl = get(opts, 'end_incl', false) ? 1 : 0
        add(highlights, [hlGroup, index, colStart, colEnd, combine, start_incl, end_incl])
      endfor
    endfor
    const priority = has_key(opts, 'priority') ? opts.priority : 4096
    Set_highlights(bufnr, key, highlights, priority)
  endif
enddef

export def Match_ranges(id: number, buf: number, ranges: list<any>, hlGroup: string, priority: any = 99): list<number>
  const winid = id == 0 ? win_getid() : id
  const bufnr = buf == 0 ? winbufnr(winid) : buf
  if empty(getwininfo(winid)) || (buf != 0 && winbufnr(winid) != buf)
    return []
  endif
  final ids = []
  final pos = []
  for range in ranges
    const start_pos = range.start
    const end_pos = range.end
    const lines = getbufline(bufnr, start_pos.line + 1, end_pos.line + 1)
    for index in range(start_pos.line, end_pos.line)
      const line = get(lines, index - start_pos.line, '')
      if len(line) == 0
        continue
      endif
      const colStart = index == start_pos.line ? coc#text#Byte_index(line, start_pos.character) : 0
      const colEnd = index == end_pos.line ? coc#text#Byte_index(line, end_pos.character) : strlen(line)
      if colStart >= colEnd
        continue
      endif
      add(pos, [index + 1, colStart + 1, colEnd - colStart])
    endfor
  endfor
  const count = len(pos)
  if count > 0
    const pr = type(priority) == v:t_number ? priority : 99
    const opts = {'window': winid}
    if count < 9 || has('patch-9.0.0622')
      ids->add(matchaddpos(hlGroup, pos, pr, -1, opts))
    else
      # limit to 8 each time
      for i in range(0, count - 1, 8)
        const end = min([i + 8, count]) - 1
        ids->add(matchaddpos(hlGroup, pos[i : end], pr, -1, opts))
      endfor
    endif
  endif
  return ids
enddef

# key could be string or number, use -1 for all highlights.
export def Get_highlights(bufnr: number, key: any, start: number, end: number): list<any>
  if !bufloaded(bufnr)
    return []
  endif
  const ns = type(key) == v:t_number ? key : Create_namespace(key)
  const types: list<string> = coc#api#GetNamespaceTypes(ns)
  if empty(types)
    return []
  endif
  final res: list<any> = []
  const endLnum: number = end == -1 ? -1 : end + 1
  for prop in prop_list(start + 1, {'bufnr': bufnr, 'types': types, 'end_lnum': endLnum})
    if prop.start == 0 || prop.end == 0
      # multi line textprop are not supported, simply ignore it
      continue
    endif
    const startCol: number = prop.col - 1
    const endCol: number = startCol + prop.length
    const hl = prop_type_get(prop.type)->get('highlight', '')
    add(res, [ hl, prop.lnum - 1, startCol, endCol, prop.id ])
  endfor
  return res
enddef

export def Del_markers(bufnr: number, key: any, ids: list<number>): void
  if bufloaded(bufnr)
    for id in ids
      prop_remove({'bufnr': bufnr, 'id': id})
    endfor
  endif
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
  const virt_lines = get(opts, 'virt_lines', [])
  var isAboveBelow = align ==# 'above' || align ==# 'below'
  if !empty(blocks) && isAboveBelow
    # only first highlight can be used
    const highlightGroup: string = blocks[0][1]
    const text: string = blocks->mapnew((_, block: list<string>): string => block[0])->join('')
    blockList = [[text, highlightGroup]]
    propColumn = 0
  endif
  var first: bool = true
  final base: dict<any> = { 'priority': priority }
  if propColumn == 0 && align != 'overlay'
    base.text_align = align
  endif
  if has_key(opts, 'text_wrap')
    base.text_wrap = opts.text_wrap
  endif
  var before: string = ''
  for blockItem in blockList
    const text = empty(before) ? blockItem[0] : $'{before}{blockItem[0]}'
    const highlightGroup: string = get(blockItem, 1, '')
    if empty(highlightGroup)
      # should be spaces
      before = text
      continue
    endif
    before = ''
    const type: string = coc#api#CreateType(ns, highlightGroup, opts)
    final propOpts: dict<any> = extend({ 'text': text, 'type': type, 'bufnr': bufnr }, base)
    if first && propColumn == 0
      # add a whitespace, same as neovim.
      if align ==# 'after'
        propOpts.text_padding_left = 1
      elseif !empty(pre) && isAboveBelow
        propOpts.text_padding_left = Calc_padding_size(bufnr, pre)
      endif
    endif
    prop_add(line + 1, propColumn, propOpts)
    first = false
  endfor
  for item_list in virt_lines
    for [text, highlightGroup] in item_list
      const type: string = coc#api#CreateType(ns, highlightGroup, opts)
      final propOpts: dict<any> = { 'text': text, 'type': type, 'bufnr': bufnr, 'text_align': 'below'}
      prop_add(line + 1, 0, propOpts)
    endfor
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
            priority: number, changedtick: number): void
  if !bufloaded(bufnr) || getbufvar(bufnr, 'changedtick', 0) != changedtick
    return
  endif
  if len(items) > maxCount
    const hls = items[ : maxCount - 1]
    const next = items[maxCount : ]
    Add_vtext_items(bufnr, ns, hls, indent, priority)
    timer_start(10,  (_) => Add_vtexts_timer(bufnr, ns, next, indent, priority, changedtick))
  else
    Add_vtext_items(bufnr, ns, items, indent, priority)
  endif
enddef

export def Set_virtual_texts(bufnr: number, ns: number, items: list<any>, indent: bool, priority: number): void
  if bufloaded(bufnr)
    const changedtick = getbufvar(bufnr, 'changedtick', 0)
    Add_vtexts_timer(bufnr, ns, items, indent, priority, changedtick)
  endif
enddef

# Apply many text changes while preserve text props can be slow,
def Apply_changes(bufnr: number, changes: list<any>): void
  const start_time = reltime()
  const total = len(changes)
  var timeout: bool = false
  var i = total - 1
  while i >= 0
    const item = changes[i]
    # item is null for some unknown reason
    if !empty(item)
      coc#api#SetBufferText(bufnr, item[1], item[2], item[3], item[4], item[0])
    endif
    i -= 1
  endwhile
  const duration = (start_time->reltime()->reltimefloat()) * 1000
  if duration > 200
    maxEditCount = maxEditCount / 2
    coc#api#EchoHl($'Text edits cost {float2nr(duration)}ms, consider configure g:coc_edits_maximum_count < {total}', 'WarningMsg')
  endif
enddef

# Replace text before cursor at current line, insert should not includes line break.
# 0 based start col
export def Set_lines(bufnr: number, changedtick: number, original: list<string>, replacement: list<string>,
    start: number, end: number, changes: any, cursor: any, col: any, linecount: number): void
  if bufloaded(bufnr)
    const current = bufnr == bufnr('%')
    const view = current ? winsaveview() : null
    var start_row: number = start
    var end_row: number = end
    var replace = copy(replacement)
    var finished: bool = false
    var change_list = copy(changes)
    var delta: number = 0
    if current && type(col) == v:t_number
      delta = col('.') - col
    endif
    if changedtick != getbufvar(bufnr, 'changedtick') && end_row > start_row
      const line_delta = bufnr->getbufinfo()->get(0).linecount - linecount
      if line_delta == 0
        # Check current line change first
        const curr_lines = getbufline(bufnr, start_row + 1, end_row)
        const pos = getpos('.')
        const row = current ? pos[1] - start_row - 1 : -1
        for idx in range(0, len(curr_lines) - 1)
          var oldStr = get(original, idx, '')
          var newStr = get(curr_lines, idx, '')
          var replaceStr = get(replace, idx, null)
          var colIdx = idx == row ? pos[2] - 1 : -1
          if oldStr !=# newStr && replaceStr != null
            if replaceStr ==# oldStr
              replaceStr = newStr
            else
              replaceStr = coc#text#DiffApply(oldStr, newStr, replaceStr, colIdx)
            endif
            if replaceStr != null
              replace[idx] = replaceStr
            endif
            change_list = []
          endif
        endfor
      else
        # Check if change lines before or after
        # Consider changed before first
        if coc#text#LinesEqual(replace, getbufline(bufnr, start_row + 1 + line_delta, end_row + line_delta))
          start_row += line_delta
          end_row += line_delta
          change_list = []
        elseif !coc#text#LinesEqual(replace, getbufline(bufnr, start_row + 1, end_row))
          return
        endif
      endif
    endif
    if !empty(change_list) && len(change_list) <= maxEditCount
      Apply_changes(bufnr, change_list)
    else
      coc#api#SetBufferLines(bufnr, start_row + 1, end_row, replace)
    endif
    if current
      winrestview(view)
    endif
    coc#api#OnTextChange(bufnr)
    if !empty(cursor) && current
      cursor(cursor[0], cursor[1] + delta)
    endif
  endif
enddef

defcompile
