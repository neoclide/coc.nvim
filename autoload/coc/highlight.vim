" for vim8
let s:clear_match_by_window = has('nvim-0.5.0') || has('patch-8.1.1084')
let s:switch_win = has('nvim') && !has('nvim-0.5.0')
let s:namespace_map = {}
let s:ns_id = 1

" highlight LSP range,
" TODO don't know how to count UTF16 code point, should work most cases.
function! coc#highlight#range(bufnr, key, hlGroup, range) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
  let srcId = s:create_namespace(a:key)
  let start = a:range['start']
  let end = a:range['end']
  for lnum in range(start['line'] + 1, end['line'] + 1)
    let arr = getbufline(bufnr, lnum)
    let line = empty(arr) ? '' : arr[0]
    if empty(line)
      continue
    endif
    let colStart = lnum == start['line'] + 1 ? strlen(strcharpart(line, 0, start['character'])) : 0
    let colEnd = lnum == end['line'] + 1 ? strlen(strcharpart(line, 0, end['character'])) : -1
    if colStart == colEnd
      continue
    endif
    call coc#highlight#add_highlight(bufnr, srcId, a:hlGroup, lnum - 1, colStart, colEnd)
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
  let src_id = s:create_namespace(a:key)
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
  let winid = win_getid()
  if has('nvim') && winid != a:winid
    noa call nvim_set_current_win(a:winid)
  endif
  " clean highlights
  call coc#highlight#syntax_clear(a:winid)
  let bufnr = winbufnr(a:winid)
  if has('nvim')
    call nvim_buf_clear_namespace(bufnr, -1, 0, -1)
  else
    call clearmatches(a:winid)
  endif
  if !empty(a:codes)
    call coc#highlight#highlight_lines(a:winid, a:codes)
  endif
  if !empty(a:highlights)
    for item in a:highlights
      if has('nvim')
        call nvim_buf_add_highlight(bufnr, -1, item['hlGroup'], item['lnum'], item['colStart'], item['colEnd'])
      else
        let pos = [item['lnum'] +1, item['colStart'] + 1, item['colEnd'] - item['colStart']]
        call matchaddpos(item['hlGroup'], [pos], 10, -1, {'window': a:winid})
      endif
    endfor
  endif
  if has('nvim')
    noa call nvim_set_current_win(winid)
  endif
endfunction


" Add highlights to line groups of winid, support hlGroup and filetype
" config should have startLine, endLine (1 based, end excluded) and filetype or hlGroup
" endLine should > startLine and endLine is excluded
"
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#highlight_lines(winid, blocks) abort
  if has('nvim') && win_getid() != a:winid
    return
  endif
  let defined = []
  let region_id = 1
  for config in a:blocks
    let start = config['startLine'] + 1
    let end = config['endLine'] == -1 ? len(getbufline(winbufnr(a:winid), 1, '$')) + 1 : config['endLine'] + 1
    let filetype = get(config, 'filetype', '')
    let hlGroup = get(config, 'hlGroup', '')
    if !empty(hlGroup)
      call s:execute(a:winid, 'syntax region '.hlGroup.' start=/\%'.start.'l/ end=/\%'.end.'l/')
    else
      let filetype = matchstr(filetype, '\v[^.]*')
      if index(defined, filetype) == -1
        call s:execute(a:winid, 'syntax include @'.toupper(filetype).' syntax/'.filetype.'.vim')
        call add(defined, filetype)
      endif
      call s:execute(a:winid, 'syntax region CodeBlock'.region_id.' start=/\%'.start.'l/ end=/\%'.end.'l/ contains=@'.toupper(filetype))
      let region_id = region_id + 1
    endif
  endfor
endfunction

function! coc#highlight#syntax_clear(winid) abort
  if has('nvim') && win_getid() != a:winid
    return
  endif
  call s:execute(a:winid, 'syntax clear')
endfunction

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
  if empty(getwininfo(winid)) || winbufnr(a:winid) != a:bufnr
    " not valid
    return
  endif
  if s:switch_win
    let curr = win_getid()
    noa call nvim_set_current_win(winid)
  endif
  for range in a:ranges
    let list = []
    let start = range['start']
    let end = range['end']
    for lnum in range(start['line'] + 1, end['line'] + 1)
      let arr = getbufline(a:bufnr, lnum)
      let line = empty(arr) ? '' : arr[0]
      if empty(line)
        continue
      endif
      let colStart = lnum == start['line'] + 1 ? strlen(strcharpart(line, 0, start['character'])) + 1 : 1
      let colEnd = lnum == end['line'] + 1 ? strlen(strcharpart(line, 0, end['character'])) + 1 : strlen(line) + 1
      if colStart == colEnd
        continue
      endif
      call add(list, [lnum, colStart, colEnd - colStart])
    endfor
    if !empty(list)
      if s:clear_match_by_window
        call matchaddpos(a:hlGroup, list, 10, -1, {'window': a:winid})
      else
        call matchaddpos(a:hlGroup, list, 10)
      endif
    endif
  endfor
  if s:switch_win
    noa call nvim_set_current_win(curr)
  endif
endfunction

" Clear matches by hlGroup regexp.
function! coc#highlight#clear_match_group(winid, match) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    " not valid
    return
  endif
  if win_getid() == winid
    let arr = filter(getmatches(), 'v:val["group"] =~# "'.a:match.'"')
    for item in arr
      call matchdelete(item['id'])
    endfor
  elseif s:clear_match_by_window
    let arr = filter(getmatches(winid), 'v:val["group"] =~# "'.a:match.'"')
    for item in arr
      call matchdelete(item['id'], winid)
    endfor
  endif
endfunction

" Clear matches by match ids, use 0 for current win.
function! coc#highlight#clear_matches(winid, ids)
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    return
  endif
  if win_getid() == winid
    for id in a:ids
      try
        call matchdelete(id)
      catch /.*/
        " matches have been cleared in other ways,
      endtry
    endfor
  elseif s:clear_match_by_window
    for id in a:ids
      try
        call matchdelete(id, winid)
      catch /.*/
        " matches have been cleared in other ways,
      endtry
    endfor
  elseif exists('*nvim_set_current_win')
    let curr = win_getid()
    noa call nvim_set_current_win(a:winid)
    for id in a:ids
      try
        call matchdelete(id, winid)
      catch /.*/
        " matches have been cleared in other ways,
      endtry
    endfor
    noa call nvim_set_current_win(curr)
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

function! s:execute(winid, cmd) abort
  if has('nvim')
    execute 'silent! ' a:cmd
  else
    call win_execute(a:winid, a:cmd, 'silent!')
  endif
endfunction

function! s:create_namespace(key) abort
  if a:key == -1
    return -1
  endif
  if has('nvim')
    return nvim_create_namespace('coc-'.a:key)
  endif
  if !has_key(s:namespace_map, a:key)
    let s:namespace_map[a:key] = s:ns_id
    let s:ns_id = s:ns_id + 1
  endif
  return s:namespace_map[a:key]
endfunction
