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
    let codes = map(a:codes, function('s:convert_code'))
    call coc#highlight#highlight_lines(a:winid, codes)
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

function! s:convert_code(...) abort
  return {
    \ 'startLine': a:2['startLine'] + 1,
    \ 'endLine': a:2['endLine'] + 1,
    \ 'filetype': get(a:2, 'filetype', ''),
    \ 'hlGroup': get(a:2, 'hlGroup', ''),
    \ }
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
function! coc#highlight#highlight_lines(winid, highlights) abort
  if has('nvim') && win_getid() != a:winid
    return
  endif
  let defined = []
  let region_id = 1
  for config in a:highlights
    let startLine = config['startLine']
    let endLine = config['endLine']
    let filetype = get(config, 'filetype', '')
    let hlGroup = get(config, 'hlGroup', '')
    if !empty(hlGroup)
      call s:execute(a:winid, 'syntax region '.hlGroup.' start=/\%'.startLine.'l/ end=/\%'.endLine.'l/')
    else
      let filetype = matchstr(filetype, '\v[^.]*')
      if index(defined, filetype) == -1
        call s:execute(a:winid, 'syntax include @'.toupper(filetype).' syntax/'.filetype.'.vim')
        call add(defined, filetype)
      endif
      call s:execute(a:winid, 'syntax region CodeBlock'.region_id.' start=/\%'.startLine.'l/ end=/\%'.endLine.'l/ contains=@'.toupper(filetype))
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

function! s:execute(winid, cmd) abort
  if has('nvim')
    execute 'silent! ' a:cmd
  else
    call win_execute(a:winid, a:cmd, 'silent!')
  endif
endfunction
