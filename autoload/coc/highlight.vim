scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:clear_match_by_window = has('nvim-0.5.0') || has('patch-8.1.1084')
let s:prop_offset = get(g:, 'coc_text_prop_offset', 1000)
let s:namespace_map = {}
let s:ns_id = 1

if has('nvim-0.5.0')
  try
    call getmatches(0)
  catch /^Vim\%((\a\+)\)\=:E118/
    let s:clear_match_by_window = 0
  endtry
endif

" Get namespaced coc highlights from range of bufnr
" start - 0 based start line index
" end - 0 based end line index, could be -1 for last line (exclusive)
function! coc#highlight#get(bufnr, key, start, end) abort
  if !has('nvim-0.5.0') && !exists('*prop_list')
    throw 'Get highlights requires neovim 0.5.0 or vim support prop_list()'
  endif
  if !has_key(s:namespace_map, a:key) || !bufloaded(a:bufnr)
    return {}
  endif
  let ns = coc#highlight#create_namespace(a:key)
  let current = {}
  if has('nvim-0.5.0')
    let end = a:end == -1 ? [-1, -1] : [a:end - 1, 0]
    let markers = nvim_buf_get_extmarks(a:bufnr, ns, [a:start, 0], end, {'details': v:true})
    for [_, row, start_col, details] in markers
      let delta = details['end_row'] - row
      if delta > 1 || (delta == 1 && details['end_col'] != 0)
        " Don't known neovim's api for multiple lines markers.
        continue
      endif
      let lines = getbufline(a:bufnr, row + 1)
      if empty(lines)
        " It's possible that markers exceeded last line.
        continue
      endif
      let text = lines[0]
      let curr = get(current, string(row), [])
      call add(curr, {
          \ 'hlGroup': details['hl_group'],
          \ 'lnum': row,
          \ 'colStart': start_col,
          \ 'colEnd': delta == 1 ? strlen(text) : details['end_col']
          \ })
      let current[string(row)] = curr
    endfor
  else
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
  let bufnr = a:bufnr
  if a:bufnr == 0
    let bufnr = bufnr('%')
  endif
  if !bufloaded(bufnr)
    return
  endif
  let start = get(a:, 1, 0)
  let end = get(a:, 2, -1)
  if empty(a:highlights)
    call coc#highlight#clear_highlight(bufnr, a:key, start, end)
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
      let items = current[lnum]
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
            if coc#helper#obj_equal(item, hi)
              call add(indexes, i)
              let nextIndex = max([nextIndex, i + 1])
            endif
          endfor
        endfor
      endif
      let currIndex = nextIndex
      " all highlights of current line exists, not clear.
      if len(indexes) == len(items)
        let exists = exists + indexes
      else
        if has('nvim')
          call nvim_buf_clear_namespace(bufnr, ns, lnum, lnum + 1)
        else
          call coc#api#call('buf_clear_namespace', [bufnr, ns, lnum, lnum + 1])
        endif
      endif
    endfor
    if has('nvim') && end == -1
      let count = nvim_buf_line_count(bufnr)
      " remove highlights exceed last line.
      call nvim_buf_clear_namespace(bufnr, ns, count, -1)
    endif
  else
    call coc#highlight#clear_highlight(bufnr, a:key, start, end)
  endif
  for i in range(0, total - 1)
    if index(exists, i) == -1
      let hi = a:highlights[i]
      call coc#highlight#add_highlight(bufnr, ns, hi['hlGroup'], hi['lnum'], hi['colStart'], hi['colEnd'])
    endif
  endfor
endfunction

function! coc#highlight#get_highlights(bufnr, key) abort
  if !has_key(s:namespace_map, a:key) || !bufloaded(a:bufnr)
    return []
  endif
  let res = []
  let ns = s:namespace_map[a:key]
  if exists('*prop_list')
    let lines = getbufline(a:bufnr, 1, '$')
    let linecount = len(lines)
    for line in range(1, linecount)
      for prop in prop_list(line, {'bufnr': a:bufnr, 'id': s:prop_offset + ns})
        if prop['start'] == 0 || prop['end'] == 0
          " multi line tokens are not supported; simply ignore it
          continue
        endif
        let text = lines[line - 1]
        call add(res, {
              \   'hlGroup': s:prop_type_hlgroup(prop['type']),
              \   'lnum': line - 1,
              \   'colStart': coc#helper#get_charactor(text, prop['col']),
              \   'colEnd': coc#helper#get_charactor(text, prop['col'] + prop['length'])
              \ })
      endfor
    endfor
  elseif has('nvim-0.5.0')
    let markers = nvim_buf_get_extmarks(a:bufnr, ns, 0, -1, {'details': v:true})
    let lines = getbufline(a:bufnr, 1, '$')
    let total = len(lines)
    for [_, line, start_col, details] in markers
      if line >= total
        " Could be markers exceed end of line
        continue
      endif
      let text = lines[line]
      let delta = details['end_row'] - line
      if delta > 1 || (delta == 1 && details['end_col'] != 0)
        " can't handle, single line only
        continue
      endif
      call add(res, {
            \   'hlGroup': details['hl_group'],
            \   'lnum': line,
            \   'colStart': coc#helper#get_charactor(text, start_col + 1),
            \   'colEnd': delta == 1 ? strchars(text) : coc#helper#get_charactor(text, details['end_col'] + 1)
            \ })
    endfor
  else
    throw 'Get highlights requires neovim 0.5.0 or vim support prop_list'
  endif
  return res
endfunction

" highlight LSP range,
function! coc#highlight#ranges(bufnr, key, hlGroup, ranges) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr) || !exists('*getbufline')
    return
  endif
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
      call coc#highlight#add_highlight(bufnr, srcId, a:hlGroup, lnum - 1, colStart, colEnd)
    endfor
  endfor
endfunction

function! coc#highlight#add_highlight(bufnr, src_id, hl_group, line, col_start, col_end) abort
  if has('nvim')
    call nvim_buf_add_highlight(a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end)
  else
    call coc#api#call('buf_add_highlight', [a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end])
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
  if a:fgGroup == a:bgGroup
    return a:fgGroup
  endif
  if hlexists(hlGroup)
    return hlGroup
  endif
  let fg = synIDattr(synIDtrans(hlID(a:fgGroup)), 'fg', 'gui')
  let bg = synIDattr(synIDtrans(hlID(a:bgGroup)), 'bg', 'gui')
  if fg =~# '^#' || bg =~# '^#'
    call s:create_gui_hlgroup(hlGroup, fg, bg, '')
  else
    let fg = synIDattr(synIDtrans(hlID(a:fgGroup)), 'fg', 'cterm')
    let bg = synIDattr(synIDtrans(hlID(a:bgGroup)), 'bg', 'cterm')
    call s:create_cterm_hlgroup(hlGroup, fg, bg, '')
  endif
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

" Sets the highlighting for the given group
function! s:create_gui_hlgroup(group, fg, bg, attr)
  if a:fg != ""
    exec "silent hi " . a:group . " guifg=" . a:fg . " ctermfg=" . coc#color#rgb2term(strpart(a:fg, 1))
  endif
  if a:bg != ""
    exec "silent hi " . a:group . " guibg=" . a:bg . " ctermbg=" . coc#color#rgb2term(strpart(a:bg, 1))
  endif
  if a:attr != ""
    exec "silent hi " . a:group . " gui=" . a:attr . " cterm=" . a:attr
  endif
endfun

function! s:create_cterm_hlgroup(group, fg, bg, attr) abort
  if a:fg != ""
    exec "silent hi " . a:group . " ctermfg=" . a:fg
  endif
  if a:bg != ""
    exec "silent hi " . a:group . " ctermbg=" . a:bg
  endif
  if a:attr != ""
    exec "silent hi " . a:group . " cterm=" . a:attr
  endif
endfunction

function! s:prop_type_hlgroup(type) abort
  if a:type=~# '^CocHighlight'
    return a:type[12:]
  endif
  return prop_type_get(a:type)['highlight']
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
