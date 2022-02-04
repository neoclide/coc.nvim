scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:clear_match_by_window = has('nvim-0.5.0') || has('patch-8.1.1084')
let s:set_extmark = exists('*nvim_buf_set_extmark')
let s:prop_offset = get(g:, 'coc_text_prop_offset', 1000)
let s:namespace_map = {}
let s:ns_id = 1
let g:coc_highlight_batch_lines = get(g:, 'coc_highlight_batch_lines', 300)
" Maxium count to highlight each time.
let g:coc_highlight_maximum_count = get(g:, 'coc_highlight_batch_count', 300)

if has('nvim-0.5.0')
  try
    call getmatches(0)
  catch /^Vim\%((\a\+)\)\=:E118/
    let s:clear_match_by_window = 0
  endtry
endif

" Update buffer region by region.
function! coc#highlight#buffer_update(bufnr, key, highlights, ...) abort
  if !bufloaded(a:bufnr)
    return
  endif
  if empty(a:highlights)
    call coc#highlight#clear_highlight(a:bufnr, a:key, 0, -1)
    return
  endif
  let priority = get(a:, 1, v:null)
  let changedtick = getbufvar(a:bufnr, 'changedtick', 0)
  if type(get(a:, 2, v:null)) == 0 && changedtick > a:2
    return
  endif
  let hls = map(copy(a:highlights), "{'hlGroup':v:val[0],'lnum':v:val[1],'colStart':v:val[2],'colEnd':v:val[3],'combine':get(v:val,4,1),'start_incl':get(v:val,5,0),'end_incl':get(v:val,6,0)}")
  let total = exists('*nvim_buf_line_count') ? nvim_buf_line_count(a:bufnr): getbufinfo(a:bufnr)[0]['linecount']
  if total <= g:coc_highlight_batch_lines || get(g:, 'coc_node_env', '') ==# 'test'
    call coc#highlight#update_highlights(a:bufnr, a:key, hls, 0, -1, priority)
    return
  endif
  if bufnr('%') == a:bufnr
    " Highlight visible region first
    let ls = line('w0')
    let le = line('w$')
    let exclude = [ls, le]
    let highlights = filter(copy(hls), 'v:val["lnum"]>='.(ls - 1).'&& v:val["lnum"] <='.(le - 1))
    call coc#highlight#update_highlights(a:bufnr, a:key, highlights, ls - 1, le, priority)
    let re = s:get_highlight_region(0, total, exclude)
    if !empty(re)
      call timer_start(50, { -> s:update_highlights_timer(a:bufnr, changedtick, a:key, priority, re[0], re[1], total, hls, exclude)})
    endif
  else
    let re = s:get_highlight_region(0, total, v:null)
    call s:update_highlights_timer(a:bufnr, changedtick, a:key, priority, re[0], re[1], total, hls, v:null)
  endif
endfunction

" Get namespaced coc highlights from range of bufnr
" start - 0 based start line index
" end - 0 based end line index, could be -1 for last line (exclusive)
function! coc#highlight#get(bufnr, key, start, end) abort
  if !has_key(s:namespace_map, a:key) || !bufloaded(a:bufnr)
    return {}
  endif
  let ns = coc#highlight#create_namespace(a:key)
  let current = {}
  if has('nvim-0.5.0')
    let end = a:end == -1 ? [-1, -1] : [a:end, 0]
    let markers = nvim_buf_get_extmarks(a:bufnr, ns, [a:start, 0], end, {'details': v:true})
    let linecount = nvim_buf_line_count(a:bufnr)
    for [_, row, start_col, details] in markers
      let delta = details['end_row'] - row
      if row >= linecount || delta > 1 || (delta == 1 && details['end_col'] != 0)
        " Ignore markers with invalid row
        " Don't known neovim's api for multiple lines markers.
        continue
      endif
      let text = get(getbufline(a:bufnr, row + 1), 0, '')
      let curr = get(current, string(row), [])
      call add(curr, {
          \ 'hlGroup': details['hl_group'],
          \ 'lnum': row,
          \ 'colStart': start_col,
          \ 'colEnd': delta == 1 ? strlen(text) : details['end_col']
          \ })
      let current[string(row)] = curr
    endfor
  elseif exists('*prop_list')
    let id = s:prop_offset + ns
    " we could only get textprops line by line
    let end = a:end == -1 ? getbufinfo(a:bufnr)[0]['linecount'] : a:end
    for line in range(a:start + 1, end)
      let items = []
      for prop in prop_list(line, {'bufnr': a:bufnr, 'id': id})
        " vim have support for cross line text props, but we're not using
        call add(items, {
              \ 'hlGroup': s:prop_type_hlgroup(prop['type']),
              \ 'lnum': line - 1,
              \ 'colStart': prop['col'] - 1,
              \ 'colEnd': prop['col'] - 1 + prop['length'] - (prop['end'] == 0 ? 1 : 0),
              \ })
      endfor
      if !empty(items)
        let current[string(line - 1)] = items
      endif
    endfor
  endif
  return current
endfunction

" Update highlights by check exists highlights.
function! coc#highlight#update_highlights(bufnr, key, highlights, ...) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
  let start = get(a:, 1, 0)
  let end = get(a:, 2, -1)
  let linecount = exists('*nvim_buf_line_count') ? nvim_buf_line_count(a:bufnr): getbufinfo(a:bufnr)[0]['linecount']
  if end >= linecount
    let end = -1
  endif
  if empty(a:highlights)
    call coc#highlight#clear_highlight(bufnr, a:key, start, end)
    return
  endif
  let priority = get(a:, 3, v:null)
  if type(get(a:, 4, v:null)) == 0 && getbufvar(bufnr, 'changedtick') > a:4
    return
  endif
  let total = len(a:highlights)
  " index list that exists with current highlights
  let exists = []
  let ns = coc#highlight#create_namespace(a:key)
  let currIndex = 0
  if has('nvim-0.5.0') || exists('*prop_list')
    let current = coc#highlight#get(bufnr, a:key, start, end)
    for lnum in sort(map(keys(current), 'str2nr(v:val)'), {a, b -> a - b})
      let items = get(current, lnum, [])
      let indexes = []
      let nextIndex = currIndex
      if currIndex != total
        for item in items
          for i in range(currIndex, total - 1)
            let hi = a:highlights[i]
            if hi['lnum'] > item['lnum']
              let nextIndex = i
              break
            endif
            if s:same_highlight(item, hi)
              call add(indexes, i)
              let nextIndex = max([nextIndex, i + 1])
            endif
          endfor
        endfor
      endif
      let currIndex = nextIndex
      " all highlights of current line exists, not clear.
      if len(indexes) == len(items)
        call extend(exists, indexes)
      else
        if has('nvim')
          call nvim_buf_clear_namespace(bufnr, ns, lnum, lnum + 1)
        else
          call coc#api#call('buf_clear_namespace', [bufnr, ns, lnum, lnum + 1])
        endif
      endif
    endfor
    if has('nvim')
      let count = nvim_buf_line_count(bufnr)
      if end == -1 || end == count
        " remove highlights exceed last line.
        call nvim_buf_clear_namespace(bufnr, ns, count, -1)
      endif
    endif
  else
    call coc#highlight#clear_highlight(bufnr, a:key, start, end)
  endif
  let indexes = range(0, total - 1)
  if !empty(exists)
    let indexes = filter(indexes, 'index(exists, v:val) == -1')
  endif
  for i in indexes
    let hi = a:highlights[i]
    let opts = {}
    if type(priority) == 0
      let opts['priority'] = priority
    endif
    for key in ['combine', 'start_incl', 'end_incl']
      if has_key(hi, key)
        let opts[key] = hi[key]
      endif
    endfor
    call coc#highlight#add_highlight(bufnr, ns, hi['hlGroup'], hi['lnum'], hi['colStart'], hi['colEnd'], opts)
  endfor
endfunction

" 0 based line, start_col and end_col
function! coc#highlight#get_highlights(bufnr, key) abort
  if !bufloaded(a:bufnr)
    return v:null
  endif
  if !has_key(s:namespace_map, a:key)
    return []
  endif
  let res = []
  let ns = s:namespace_map[a:key]
  if exists('*prop_list')
    " Could filter by end_line and types
    if has('patch-8.2.3652')
      for prop in prop_list(1, {'bufnr': a:bufnr, 'ids': [s:prop_offset + ns], 'end_lnum': -1})
        if prop['start'] == 0 || prop['end'] == 0
          " multi line textprop are not supported, simply ignore it
          continue
        endif
        let hlGroup = s:prop_type_hlgroup(prop['type'])
        let startCol = prop['col'] - 1
        let endCol = startCol + prop['length']
        call add(res, [hlGroup, prop['lnum'] - 1, startCol, endCol])
      endfor
    else
      let linecount = getbufinfo(a:bufnr)[0]['linecount']
      for line in range(1, linecount)
        for prop in prop_list(line, {'bufnr': a:bufnr, 'id': s:prop_offset + ns})
          if prop['start'] == 0 || prop['end'] == 0
            " multi line textprop are not supported, simply ignore it
            continue
          endif
          let startCol = prop['col'] - 1
          let endCol = startCol + prop['length']
          call add(res, [s:prop_type_hlgroup(prop['type']), line - 1, startCol, endCol])
        endfor
    endfor
    endif
  elseif has('nvim-0.5.0')
    let markers = nvim_buf_get_extmarks(a:bufnr, ns, 0, -1, {'details': v:true})
    let total = nvim_buf_line_count(a:bufnr)
    for [marker_id, line, start_col, details] in markers
      if line >= total
        " Could be markers exceed end of line
        continue
      endif
      let delta = details['end_row'] - line
      if delta > 1 || (delta == 1 && details['end_col'] != 0)
        " can't handle, single line only
        continue
      endif
      let endCol = details['end_col']
      if endCol == start_col
        call nvim_buf_del_extmark(a:bufnr, ns, marker_id)
        continue
      endif
      if delta == 1
        let text = get(nvim_buf_get_lines(a:bufnr, line, line + 1, 0), 0, '')
        let endCol = strlen(text)
      endif
      call add(res, [details['hl_group'], line, start_col, endCol, marker_id])
    endfor
  else
    throw 'Get highlights requires neovim 0.5.0 or vim support prop_list'
  endif
  return res
endfunction

" Add multiple highlights to buffer.
" type HighlightItem = [hlGroup, lnum, colStart, colEnd, combine?, start_incl?, end_incl?]
function! coc#highlight#set(bufnr, key, highlights, priority) abort
  if !bufloaded(a:bufnr)
    return
  endif
    let ns = coc#highlight#create_namespace(a:key)
    if len(a:highlights) > g:coc_highlight_maximum_count
      call s:add_highlights_timer(a:bufnr, ns, a:highlights, a:priority)
    else
      call s:add_highlights(a:bufnr, ns, a:highlights, a:priority)
    endif
endfunction

" Clear highlights by 0 based line numbers.
function! coc#highlight#clear(bufnr, key, lnums) abort
  if !bufloaded(a:bufnr)
    return
  endif
  let ns = coc#highlight#create_namespace(a:key)
  for lnum in a:lnums
    if has('nvim')
      call nvim_buf_clear_namespace(a:bufnr, ns, lnum, lnum + 1)
    else
      call coc#api#call('buf_clear_namespace', [a:bufnr, ns, lnum, lnum + 1])
    endif
  endfor
  " clear highlights in invalid line.
  if has('nvim')
    let linecount = nvim_buf_line_count(a:bufnr)
    call nvim_buf_clear_namespace(a:bufnr, ns, linecount, -1)
  endif
endfunction

function! coc#highlight#del_markers(bufnr, key, ids) abort
  if !bufloaded(a:bufnr)
    return
  endif
  let ns = coc#highlight#create_namespace(a:key)
  for id in a:ids
    call nvim_buf_del_extmark(a:bufnr, ns, id)
  endfor
endfunction


" highlight LSP range,
function! coc#highlight#ranges(bufnr, key, hlGroup, ranges, ...) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr) || !exists('*getbufline')
    return
  endif
  let opts = get(a:, 1, {})
  let synmaxcol = getbufvar(a:bufnr, '&synmaxcol', 1000)
  if synmaxcol == 0
    let synmaxcol = 1000
  endif
  let synmaxcol = min([synmaxcol, 1000])
  let srcId = coc#highlight#create_namespace(a:key)
  for range in a:ranges
    let start = range['start']
    let end = range['end']
    for lnum in range(start['line'] + 1, end['line'] + 1)
      let arr = getbufline(bufnr, lnum)
      let line = empty(arr) ? '' : arr[0]
      if empty(line)
        continue
      endif
      if start['character'] > synmaxcol || end['character'] > synmaxcol
        continue
      endif
      " TODO don't know how to count UTF16 code point, should work most cases.
      let colStart = lnum == start['line'] + 1 ? strlen(strcharpart(line, 0, start['character'])) : 0
      let colEnd = lnum == end['line'] + 1 ? strlen(strcharpart(line, 0, end['character'])) : -1
      if colStart == colEnd
        continue
      endif
      call coc#highlight#add_highlight(bufnr, srcId, a:hlGroup, lnum - 1, colStart, colEnd, opts)
    endfor
  endfor
endfunction

function! coc#highlight#add_highlight(bufnr, src_id, hl_group, line, col_start, col_end, ...) abort
  let opts = get(a:, 1, {})
  let priority = get(opts, 'priority', v:null)
  if has('nvim')
    if s:set_extmark && a:src_id != -1
      try
        call nvim_buf_set_extmark(a:bufnr, a:src_id, a:line, a:col_start, {
              \ 'end_col': a:col_end,
              \ 'hl_group': a:hl_group,
              \ 'hl_mode': get(opts, 'combine', 1) ? 'combine' : 'replace',
              \ 'right_gravity': v:false,
              \ 'end_right_gravity': v:false,
              \ 'priority': type(priority) == 0 ?  min([priority, 4096]) : 4096,
              \ })
      catch /^Vim\%((\a\+)\)\=:E5555/
        " the end_col could be invalid, ignore this error
      endtry
    else
      call nvim_buf_add_highlight(a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end)
    endif
  else
    call coc#api#call('buf_add_highlight', [a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end, opts])
  endif
endfunction

function! coc#highlight#clear_highlight(bufnr, key, start_line, end_line) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
  let src_id = coc#highlight#create_namespace(a:key)
  if has('nvim')
    call nvim_buf_clear_namespace(a:bufnr, src_id, a:start_line, a:end_line)
  else
    call coc#api#call('buf_clear_namespace', [a:bufnr, src_id, a:start_line, a:end_line])
  endif
endfunction

" highlight buffer in winid with CodeBlock &HighlightItems
" export interface HighlightItem {
"   lnum: number // 0 based
"   hlGroup: string
"   colStart: number // 0 based
"   colEnd: number
" }
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#add_highlights(winid, codes, highlights) abort
  " clear highlights
  call coc#compat#execute(a:winid, 'syntax clear')
  let bufnr = winbufnr(a:winid)
  call coc#highlight#clear_highlight(bufnr, -1, 0, -1)
  if !empty(a:codes)
    call coc#highlight#highlight_lines(a:winid, a:codes)
  endif
  if !empty(a:highlights)
    for item in a:highlights
      call coc#highlight#add_highlight(bufnr, -1, item['hlGroup'], item['lnum'], item['colStart'], item['colEnd'])
    endfor
  endif
endfunction


" Add highlights to line groups of winid, support hlGroup and filetype
" config should have startLine, endLine (0 based, end excluded) and filetype or hlGroup
" endLine should > startLine and endLine is excluded
"
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#highlight_lines(winid, blocks) abort
  let region_id = 1
  let defined = []
  let cmds = []
  for config in a:blocks
    let start = config['startLine'] + 1
    let end = config['endLine'] == -1 ? len(getbufline(winbufnr(a:winid), 1, '$')) + 1 : config['endLine'] + 1
    let filetype = get(config, 'filetype', '')
    let hlGroup = get(config, 'hlGroup', '')
    if !empty(hlGroup)
      call add(cmds, 'syntax region '.hlGroup.' start=/\%'.start.'l/ end=/\%'.end.'l/')
    else
      let filetype = matchstr(filetype, '\v^\w+')
      if empty(filetype) || filetype == 'txt' || index(get(g:, 'coc_markdown_disabled_languages', []), filetype) != -1
        continue
      endif
      if index(defined, filetype) == -1
        call add(cmds, 'syntax include @'.toupper(filetype).' syntax/'.filetype.'.vim')
        call add(cmds, 'unlet! b:current_syntax')
        call add(defined, filetype)
      endif
      call add(cmds, 'syntax region CodeBlock'.region_id.' start=/\%'.start.'l/ end=/\%'.end.'l/ contains=@'.toupper(filetype).' keepend')
      let region_id = region_id + 1
    endif
  endfor
  if !empty(cmds)
    call coc#compat#execute(a:winid, cmds, 'silent!')
  endif
endfunction

" Copmpose hlGroups with foreground and background colors.
function! coc#highlight#compose_hlgroup(fgGroup, bgGroup) abort
  let hlGroup = 'Fg'.a:fgGroup.'Bg'.a:bgGroup
  if a:fgGroup ==# a:bgGroup
    return a:fgGroup
  endif
  if hlexists(hlGroup)
    return hlGroup
  endif
  let fgId = synIDtrans(hlID(a:fgGroup))
  let bgId = synIDtrans(hlID(a:bgGroup))
  let isGuiReversed = synIDattr(fgId, 'reverse', 'gui') !=# '1' || synIDattr(bgId, 'reverse', 'gui') !=# '1'
  let guifg = isGuiReversed ? synIDattr(fgId, 'fg', 'gui') : synIDattr(fgId, 'bg', 'gui')
  let guibg = isGuiReversed ? synIDattr(bgId, 'bg', 'gui') : synIDattr(bgId, 'fg', 'gui')
  let isCtermReversed = synIDattr(fgId, 'reverse', 'cterm') !=# '1' || synIDattr(bgId, 'reverse', 'cterm') !=# '1'
  let ctermfg = isCtermReversed ? synIDattr(fgId, 'fg', 'cterm') : synIDattr(fgId, 'bg', 'cterm')
  let ctermbg = isCtermReversed ? synIDattr(bgId, 'bg', 'cterm') : synIDattr(bgId, 'fg', 'cterm')
  let bold = synIDattr(fgId, 'bold') ==# '1'
  let italic = synIDattr(fgId, 'italic') ==# '1'
  let underline = synIDattr(fgId, 'underline') ==# '1'
  let cmd = 'silent hi ' . hlGroup
  if !empty(guifg)
    let cmd .= ' guifg=' . guifg
  endif
  if !empty(ctermfg)
    let cmd .= ' ctermfg=' . ctermfg
  elseif guifg =~# '^#'
    let cmd .= ' ctermfg=' . coc#color#rgb2term(strpart(guifg, 1))
  endif
  if !empty(guibg)
    let cmd .= ' guibg=' . guibg
  endif
  if !empty(ctermbg)
    let cmd .= ' ctermbg=' . ctermbg
  elseif guibg =~# '^#'
    let cmd .= ' ctermbg=' . coc#color#rgb2term(strpart(guibg, 1))
  endif
  if bold
    let cmd .= ' cterm=bold gui=bold'
  elseif italic
    let cmd .= ' cterm=italic gui=italic'
  elseif underline
    let cmd .= ' cterm=underline gui=underline'
  endif
  if cmd ==# 'silent hi ' . hlGroup
      return 'Normal'
  endif
  execute cmd
  return hlGroup
endfunction

" add matches for winid, use 0 for current window.
function! coc#highlight#match_ranges(winid, bufnr, ranges, hlGroup, priority) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  let bufnr = a:bufnr == 0 ? winbufnr(winid) : a:bufnr
  if empty(getwininfo(winid)) || (a:bufnr != 0 && winbufnr(a:winid) != a:bufnr)
    " not valid
    return []
  endif
  if !s:clear_match_by_window
    let curr = win_getid()
    if has('nvim')
      noa call nvim_set_current_win(winid)
    else
      noa call win_gotoid(winid)
    endif
  endif
  let ids = []
  for range in a:ranges
    let pos = []
    let start = range['start']
    let end = range['end']
    for lnum in range(start['line'] + 1, end['line'] + 1)
      let arr = getbufline(bufnr, lnum)
      let line = empty(arr) ? '' : arr[0]
      if empty(line)
        continue
      endif
      let colStart = lnum == start['line'] + 1 ? strlen(strcharpart(line, 0, start['character'])) + 1 : 1
      let colEnd = lnum == end['line'] + 1 ? strlen(strcharpart(line, 0, end['character'])) + 1 : strlen(line) + 1
      if colStart == colEnd
        continue
      endif
      call add(pos, [lnum, colStart, colEnd - colStart])
    endfor
    if !empty(pos)
      let opts = s:clear_match_by_window ? {'window': a:winid} : {}
      let i = 1
      let l = []
      for p in pos
        call add(l, p)
        if i % 8 == 0
          let id = matchaddpos(a:hlGroup, l, a:priority, -1, opts)
          call add(ids, id)
          let l = []
        endif
        let i += 1
      endfor
      if !empty(l)
        let id = matchaddpos(a:hlGroup, l, a:priority, -1, opts)
        call add(ids, id)
      endif
    endif
  endfor
  if !s:clear_match_by_window
    if has('nvim')
      noa call nvim_set_current_win(curr)
    else
      noa call win_gotoid(curr)
    endif
  endif
  return ids
endfunction

" Clear matches by hlGroup regexp.
function! coc#highlight#clear_match_group(winid, match) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    " not valid
    return
  endif
  if s:clear_match_by_window
    let arr = filter(getmatches(winid), 'v:val["group"] =~# "'.a:match.'"')
    for item in arr
      call matchdelete(item['id'], winid)
    endfor
  else
    let curr = win_getid()
    let switch = exists('*nvim_set_current_win') && curr != winid
    if switch
      noa call nvim_set_current_win(a:winid)
    endif
    if win_getid() == winid
      let arr = filter(getmatches(), 'v:val["group"] =~# "'.a:match.'"')
      for item in arr
        call matchdelete(item['id'])
      endfor
    endif
    if switch
      noa call nvim_set_current_win(curr)
    endif
  endif
endfunction

" Clear matches by match ids, use 0 for current win.
function! coc#highlight#clear_matches(winid, ids)
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    " not valid
    return
  endif
  if s:clear_match_by_window
    for id in a:ids
      try
        call matchdelete(id, winid)
      catch /^Vim\%((\a\+)\)\=:E803/
        " ignore
      endtry
    endfor
  else
    let curr = win_getid()
    let switch = exists('*nvim_set_current_win') && curr != winid
    if switch
      noa call nvim_set_current_win(a:winid)
    endif
    if win_getid() == winid
      for id in a:ids
        try
          call matchdelete(id)
        catch /^Vim\%((\a\+)\)\=:E803/
          " ignore
        endtry
      endfor
    endif
    if switch
      noa call nvim_set_current_win(curr)
    endif
  endif
endfunction

function! s:prop_type_hlgroup(type) abort
  if a:type=~# '^CocHighlight'
    return strpart(a:type, 12)
  endif
  return get(prop_type_get(a:type), 'highlight', '')
endfunction

function! coc#highlight#create_namespace(key) abort
  if type(a:key) == 0
    return a:key
  endif
  if has_key(s:namespace_map, a:key)
    return s:namespace_map[a:key]
  endif
  if has('nvim')
    let s:namespace_map[a:key] = nvim_create_namespace('coc-'.a:key)
  else
    let s:namespace_map[a:key] = s:ns_id
    let s:ns_id = s:ns_id + 1
  endif
  return s:namespace_map[a:key]
endfunction

function! coc#highlight#get_syntax_name(lnum, col)
  return synIDattr(synIDtrans(synID(a:lnum,a:col,1)),"name")
endfunction

" TODO support check for virt_text
function! s:same_highlight(one, other) abort
  if a:one['hlGroup'] !=# a:other['hlGroup']
    return 0
  endif
  if a:one['lnum'] != a:other['lnum']
    return 0
  endif
  if a:one['colStart'] !=# a:other['colStart']
    return 0
  endif
  if a:one['colEnd'] !=# a:other['colEnd']
    return 0
  endif
  return 1
endfunction

function! s:update_highlights_timer(bufnr, changedtick, key, priority, start, end, total, highlights, exclude) abort
  if getbufvar(a:bufnr, 'changedtick', 0) != a:changedtick
    return
  endif
  let highlights = filter(copy(a:highlights), 'v:val["lnum"] >='.a:start.' && v:val["lnum"] <'.a:end)
  let end = a:end
  if empty(highlights) && end > 0
    " find maximum lnum to clear
    let till = type(a:exclude) == 3 && end < get(a:exclude, 0, 0) ? get(a:exclude, 0, 0) : a:total
    if till > end
      let minimal = till
      for hl in filter(copy(a:highlights), 'v:val["lnum"] >='.end.' && v:val["lnum"] <'.till)
        let minimal = min([minimal, hl['lnum']])
      endfor
      let end = minimal
    endif
  endif
  "call coc#rpc#notify('log', ['update_timer', a:bufnr, a:changedtick, a:key, a:start, end, a:total, highlights, a:exclude])
  call coc#highlight#update_highlights(a:bufnr, a:key, highlights, a:start, end, a:priority)
  let re = s:get_highlight_region(end, a:total, a:exclude)
  if !empty(re)
    call timer_start(50, { -> s:update_highlights_timer(a:bufnr, a:changedtick, a:key, a:priority, re[0], re[1], a:total, a:highlights, a:exclude)})
  endif
endfunction

" Get 0 based, end exclusive region to highlight.
function! s:get_highlight_region(start, total, exclude) abort
  if a:start >= a:total
    return v:null
  endif
  if empty(a:exclude)
    let end = min([a:total, a:start + g:coc_highlight_batch_lines])
    return [a:start, end]
  endif
  if a:start < a:exclude[0] - 1
    let end = min([a:exclude[0] - 1, a:start + g:coc_highlight_batch_lines])
    return [a:start, end]
  endif
  let start = a:start
  if a:start >= a:exclude[0] - 1 && a:start <= a:exclude[1] - 1
    let start = a:exclude[1]
  endif
  if start >= a:total
    return v:null
  endif
  let end = min([a:total, start + g:coc_highlight_batch_lines])
  return [start, end]
endfunction

function! s:add_highlights_timer(bufnr, ns, highlights, priority) abort
  let hls = []
  let next = []
  for i in range(0, len(a:highlights) - 1)
    if i < g:coc_highlight_maximum_count
      call add(hls, a:highlights[i])
    else
      call add(next, a:highlights[i])
    endif
  endfor
  call s:add_highlights(a:bufnr, a:ns, hls, a:priority)
  if len(next)
    call timer_start(30, {->s:add_highlights_timer(a:bufnr, a:ns, next, a:priority)})
  endif
endfunction

function! s:add_highlights(bufnr, ns, highlights, priority) abort
  for item in a:highlights
    let opts = {
          \ 'priority': a:priority,
          \ 'combine': get(item, 4, 1) ? 1 : 0,
          \ 'start_incl': get(item, 5, 0) ? 1 : 0,
          \ 'end_incl':  get(item, 6, 0) ? 1 : 0,
          \ }
    call coc#highlight#add_highlight(a:bufnr, a:ns, item[0], item[1], item[2], item[3], opts)
  endfor
endfunction
