let g:coc_max_treeview_width = get(g:, 'coc_max_treeview_width', 40)
let s:is_vim = !has('nvim')

" Get tabpagenr of winid, return -1 if window doesn't exist
function! coc#window#tabnr(winid) abort
  " getwininfo not work with popup on vim
  if s:is_vim && index(popup_list(), a:winid) != -1
    call win_execute(a:winid, 'let g:__coc_tabnr = tabpagenr()')
    let nr = g:__coc_tabnr
    unlet g:__coc_tabnr
    return nr
  endif
  let info = getwininfo(a:winid)
  return empty(info) ? -1 : info[0]['tabnr']
endfunction

" (1, 0) based line, column
function! coc#window#get_cursor(winid) abort
  if exists('*nvim_win_get_cursor')
    return nvim_win_get_cursor(a:winid)
  endif
  let pos = getcurpos(a:winid)
  return [pos[1], pos[2] - 1]
endfunction

" Check if winid visible on current tabpage
function! coc#window#visible(winid) abort
  if s:is_vim
    if coc#window#tabnr(a:winid) != tabpagenr()
      return 0
    endif
    " Check possible hidden popup
    try
      return get(popup_getpos(a:winid), 'visible', 0) == 1
    catch /^Vim\%((\a\+)\)\=:E993/
      return 1
    endtry
  else
    if !nvim_win_is_valid(a:winid)
      return 0
    endif
    return coc#window#tabnr(a:winid) == tabpagenr()
  endif
endfunction

" winid is popup and shown
function! s:visible_popup(winid) abort
  if index(popup_list(), a:winid) != -1
    return get(popup_getpos(a:winid), 'visible', 0) == 1
  endif
  return 0
endfunction

" Return default or v:null when name or window doesn't exist,
" 'getwinvar' only works on window of current tab
function! coc#window#get_var(winid, name, ...) abort
  let tabnr = coc#window#tabnr(a:winid)
  if tabnr == -1
    return get(a:, 1, v:null)
  endif
  return gettabwinvar(tabnr, a:winid, a:name, get(a:, 1, v:null))
endfunction

" Not throw like setwinvar
function! coc#window#set_var(winid, name, value) abort
  let tabnr = coc#window#tabnr(a:winid)
  if tabnr == -1
    return
  endif
  call settabwinvar(tabnr, a:winid, a:name, a:value)
endfunction

function! coc#window#is_float(winid) abort
  if s:is_vim
    return index(popup_list(), a:winid) != -1
  else
    if nvim_win_is_valid(a:winid)
      let config = nvim_win_get_config(a:winid)
      return !empty(get(config, 'relative', ''))
    endif
  endif
  return 0
endfunction

" Reset current lnum & topline of window
function! coc#window#restview(winid, lnum, topline) abort
  if empty(getwininfo(a:winid))
    return
  endif
  if s:is_vim && s:visible_popup(a:winid)
    call popup_setoptions(a:winid, {'firstline': a:topline})
    return
  endif
  call win_execute(a:winid, ['noa call winrestview({"lnum":'.a:lnum.',"topline":'.a:topline.'})'])
endfunction

function! coc#window#set_height(winid, height) abort
  if empty(getwininfo(a:winid))
    return
  endif
  if !s:is_vim
    call nvim_win_set_height(a:winid, a:height)
  else
    if coc#window#is_float(a:winid)
      call popup_move(a:winid, {'minheight': a:height, 'maxheight': a:height})
    else
      call win_execute(a:winid, 'noa resize '.a:height)
    endif
  endif
endfunction

function! coc#window#adjust_width(winid) abort
  let bufnr = winbufnr(a:winid)
  if bufloaded(bufnr)
    let maxwidth = 0
    let lines = getbufline(bufnr, 1, '$')
    if len(lines) > 2
      call win_execute(a:winid, 'setl nowrap')
      for line in lines
        let w = strwidth(line)
        if w > maxwidth
          let maxwidth = w
        endif
      endfor
    endif
    if maxwidth > winwidth(a:winid)
      call win_execute(a:winid, 'vertical resize '.min([maxwidth, g:coc_max_treeview_width]))
    endif
  endif
endfunction

" Get single window by window variable, current tab only
function! coc#window#find(key, val) abort
  for i in range(1, winnr('$'))
    let res = getwinvar(i, a:key)
    if res == a:val
      return win_getid(i)
    endif
  endfor
  return -1
endfunction

" Visible buffer numbers
function! coc#window#bufnrs() abort
  let winids = map(getwininfo(), 'v:val["winid"]')
  return uniq(map(winids, 'winbufnr(v:val)'))
endfunction

function! coc#window#buf_winid(bufnr) abort
  let winids = map(getwininfo(), 'v:val["winid"]')
  for winid in winids
    if winbufnr(winid) == a:bufnr
      return winid
    endif
  endfor
  return -1
endfunction

" Avoid errors
function! coc#window#close(winid) abort
  if empty(a:winid) || a:winid == -1
    return
  endif
  if coc#window#is_float(a:winid)
    call coc#float#close(a:winid)
    return
  endif
  call win_execute(a:winid, 'noa close!', 'silent!')
endfunction

function! coc#window#visible_range(winid) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  let info = get(getwininfo(winid), 0, v:null)
  if empty(info)
    return v:null
  endif
  return [info['topline'], info['botline']]
endfunction

function! coc#window#visible_ranges(bufnr) abort
  let wins = gettabinfo(tabpagenr())[0]['windows']
  let res = []
  for id in wins
    let info = getwininfo(id)[0]
    if info['bufnr'] == a:bufnr
      call add(res, [info['topline'], info['botline']])
    endif
  endfor
  return res
endfunction

" Clear matches by hlGroup regexp.
function! coc#window#clear_match_group(winid, match) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  if !empty(getwininfo(winid))
    let arr = filter(getmatches(winid), 'v:val["group"] =~# "'.a:match.'"')
    for item in arr
      call matchdelete(item['id'], winid)
    endfor
  endif
endfunction

" Clear matches by match ids, use 0 for current win.
function! coc#window#clear_matches(winid, ids) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  if !empty(getwininfo(winid))
    for id in a:ids
      try
        call matchdelete(id, winid)
      catch /^Vim\%((\a\+)\)\=:E803/
        " ignore
      endtry
    endfor
  endif
endfunction
