
" highlight LSP range,
" TODO don't know how to count UTF16 code point, should work most cases.
function! coc#highlight#range(bufnr, srcId, hlGroup, range) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
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
    call coc#highlight#add_highlight(bufnr, a:srcId, a:hlGroup, lnum - 1, colStart, colEnd)
  endfor
endfunction

function! coc#highlight#add_highlight(bufnr, src_id, hl_group, line, col_start, col_end) abort
  if has('nvim')
    call nvim_buf_add_highlight(a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end)
  else
    call coc#api#call('buf_add_highlight', [a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end])
  endif
endfunction

function! coc#highlight#clear_highlight(bufnr, src_id, start_line, end_line) abort
  if has('nvim')
    call nvim_buf_clear_namespace(a:bufnr, a:src_id, a:start_line, a:end_line)
  else
    call coc#api#call('buf_clear_namespace', [a:bufnr, a:src_id, a:start_line, a:end_line])
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

" clear document highlights of current window
function! coc#highlight#clear_highlights(...) abort
    let winid = get(a:, 1, win_getid())
    if empty(getwininfo(winid))
      " not valid
      return
    endif
    if winid == win_getid()
      let arr = filter(getmatches(), 'v:val["group"] =~# "^CocHighlight"')
      for item in arr
        call matchdelete(item['id'])
      endfor
    elseif s:clear_match_by_id
      let arr = filter(getmatches(winid), 'v:val["group"] =~# "^CocHighlight"')
      for item in arr
        call matchdelete(item['id'], winid)
      endfor
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
