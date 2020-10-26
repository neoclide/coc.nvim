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

" Add highlight to lines of window id
" config should have startLine, endLine and filetype or hlGroup
" endLine should > startLine and endLine is excluded
function! coc#highlight#highlight_lines(winid, configs) abort
  if has('nvim') && win_getid() != a:winid
    return
  endif
  let defined = []
  let region_id = 1
  for config in a:configs
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
