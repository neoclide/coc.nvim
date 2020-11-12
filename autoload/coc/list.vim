let s:is_vim = !has('nvim')
let s:preview_bufnr = 0

function! coc#list#getchar() abort
  return coc#prompt#getchar()
endfunction

function! coc#list#setlines(lines, append)
  if a:append
    silent call append(line('$'), a:lines)
  else
    silent call append(0, a:lines)
    if exists('*deletebufline')
      call deletebufline('%', len(a:lines) + 1, '$')
    else
      let n = len(a:lines) + 1
      let saved_reg = @"
      silent execute n.',$d'
      let @" = saved_reg
    endif
  endif
endfunction

function! coc#list#options(...)
  let list = ['--top', '--tab', '--normal', '--no-sort', '--input', '--strict',
        \ '--regex', '--interactive', '--number-select', '--auto-preview',
        \ '--ignore-case', '--no-quit', '--first']
  if get(g:, 'coc_enabled', 0)
    let names = coc#rpc#request('listNames', [])
    call extend(list, names)
  endif
  return join(list, "\n")
endfunction

function! coc#list#names(...) abort
  let names = coc#rpc#request('listNames', [])
  return join(names, "\n")
endfunction

function! coc#list#status(name)
  if !exists('b:list_status') | return '' | endif
  return get(b:list_status, a:name, '')
endfunction

function! coc#list#create(position, height, name, numberSelect)
  if a:position ==# 'tab'
    execute 'silent tabe list:///'.a:name
  else
    execute 'silent keepalt '.(a:position ==# 'top' ? '' : 'botright').a:height.'sp list:///'.a:name
    execute 'resize '.a:height
  endif
  if a:numberSelect
    setl norelativenumber
    setl number
  else
    setl nonumber
    setl norelativenumber
    setl signcolumn=yes
  endif
  return [bufnr('%'), win_getid()]
endfunction

" close list windows
function! coc#list#clean_up() abort
  for i in range(1, winnr('$'))
    let bufname = bufname(winbufnr(i))
    if bufname =~# 'list://'
      execute i.'close!'
    endif
  endfor
endfunction

function! coc#list#setup(source)
  let b:list_status = {}
  setl buftype=nofile nobuflisted nofen nowrap
  setl norelativenumber bufhidden=wipe cursorline winfixheight
  setl tabstop=1 nolist nocursorcolumn undolevels=-1
  setl signcolumn=auto
  if has('nvim-0.5.0') || has('patch-8.1.0864')
    setl scrolloff=0
  endif
  if exists('&cursorlineopt')
    setl cursorlineopt=both
  endif
  setl filetype=list
  syntax case ignore
  let source = a:source[8:]
  let name = toupper(source[0]).source[1:]
  execute 'syntax match Coc'.name.'Line /\v^.*$/'
  nnoremap <silent><nowait><buffer> <esc> <C-w>c
endfunction

function! coc#list#has_preview()
  for i in range(1, winnr('$'))
    let preview = getwinvar(i, '&previewwindow')
    if preview
      return 1
    endif
  endfor
  return 0
endfunction

function! coc#list#restore(winid, height)
  let res = win_gotoid(a:winid)
  if res == 0 | return | endif
  if winnr('$') == 1
    return
  endif
  execute 'resize '.a:height
  if s:is_vim
    redraw
  endif
endfunction

function! coc#list#set_height(height) abort
  if winnr('$') == 1| return | endif
  execute 'resize '.a:height
endfunction

function! coc#list#hide(original, height, winid) abort
  if s:preview_bufnr
    let winid = bufwinid(s:preview_bufnr)
    if winid != -1
      call s:close_win(winid)
    endif
  endif
  if !empty(getwininfo(a:original))
    call win_gotoid(a:original)
  endif
  if a:winid
    call s:close_win(a:winid)
  endif
  if a:height
    if exists('*nvim_win_set_height')
      call nvim_win_set_height(a:original, a:height)
    elseif win_getid() == a:original
      execute 'resize '.a:height
    endif
  endif
  redraw
endfunction

function! s:close_win(winid) abort
  if a:winid == 0 || empty(getwininfo(a:winid))
    return
  endif
  if s:is_vim
    if exists('*win_execute')
      noa call win_execute(a:winid, 'close!', 'silent!')
    else
      if win_getid() == a:winid
        noa silent! close!
      else
        let winid = win_getid()
        let res = win_gotoid(winid)
        if res
          noa silent! close!
          noa wincmd p
        endif
      endif
    endif
  else
    if nvim_win_is_valid(a:winid)
      silent! noa call nvim_win_close(a:winid, 1)
    endif
  endif
endfunction

" Improve preview performance by reused window & buffer.
" lines - list of lines
" config.position - could be 'below' 'top' 'tab'.
" config.name - (optional )name of preview buffer.
" config.splitRight - (optional) split to right when 1.
" config.lnum - (optional) current line number
" config.filetype - (optional) filetype of lines.
" config.hlGroup - (optional) highlight group.
" config.maxHeight - (optional) max height of window, valid for 'below' & 'top' position.
function! coc#list#preview(lines, config) abort
  if s:is_vim && !exists('*win_execute')
    echoerr 'win_execute function required for preview, please upgrade your vim.'
    return
  endif
  if empty(a:lines)
    silent! pclose
    return
  endif
  " Try reuse buffer & window
  let s:preview_bufnr = coc#float#create_buf(s:preview_bufnr, a:lines)
  if s:preview_bufnr == 0
    return
  endif
  let filetype = get(a:config, 'filetype', '')
  let range = get(a:config, 'range', v:null)
  let hlGroup = get(a:config, 'hlGroup', 'Search')
  let lnum = get(a:config, 'lnum', 1)
  let winid = bufwinid(s:preview_bufnr)
  let position = get(a:config, 'position', 'below')
  if winid > 0 && win_id2win(winid) == 0
    " not in current tab
    if s:is_vim
      noa call win_execute(winid, 'close!', 'silent!')
    else
      call nvim_win_close(winid)
    endif
    let winid = -1
  endif
  let commands = []
  if winid == -1
    let winid = s:get_preview_winid()
    if winid == -1
      let change = position != 'tab' && get(a:config, 'splitRight', 0)
      let curr = win_getid()
      if change
        noa wincmd t
        noa belowright vnew +setl\ previewwindow
        let winid = win_getid()
      elseif position == 'tab' || get(a:config, 'splitRight', 0)
        noa belowright vnew +setl\ previewwindow
        let winid = win_getid()
      else
        let mod = position == 'top' ? 'below' : 'above'
        let height = s:get_height(a:lines, a:config)
        execute 'noa '.mod.' '.height.'new +setl\ previewwindow'
        let winid = win_getid()
      endif
      noa call win_gotoid(curr)
    endif
    " load the buffer to preview window
    if has('nvim')
      noa call nvim_win_set_buf(winid, s:preview_bufnr)
    else
      call win_execute(winid, 'noa silent! b '.s:preview_bufnr)
    endif
  endif
  if winid == -1
    return
  endif
  if s:is_vim
    call add(commands, 'noa file [Preview] ' . fnameescape(get(a:config, 'name', '[Sketch]')))
  else
    noa call nvim_buf_set_name(s:preview_bufnr, '[Preview] ' . get(a:config, 'name', '[Sketch]'))
  endif
  " height of window
  let height = s:get_height(a:lines, a:config)
  if height != 0
    call add(commands, 'noa resize '.height)
  endif
  " change to current line.
  call add(commands, 'noa call winrestview({"lnum":'.lnum.',"topline":'.max([1, lnum - 3]).'})')
  " highlights
  call add(commands, 'syntax clear')
  if empty(filetype) && !empty(get(a:config, 'name', ''))
    call add(commands, 'filetype detect')
  elseif !empty(filetype)
    call add(commands, 'setfiletype '.filetype)
  endif
  call coc#float#execute(winid, commands)
  if !empty(range)
    call coc#highlight#clear_highlight(s:preview_bufnr, -1, 0, -1)
    call coc#highlight#range(s:preview_bufnr, 'list', hlGroup, range)
    call setwinvar(winid, '&cursorline', 1)
  endif
  redraw
endfunction

function! s:get_height(lines, config) abort
  if get(a:config, 'splitRight', 0) || get(a:config, 'position', 'below') == 'tab'
    return 0
  endif
  let height = min([get(a:config, 'maxHeight', 10), len(a:lines), &lines - &cmdheight - 2])
  return height
endfunction

function! s:get_preview_winid() abort
  for i in range(1, winnr('$'))
    if getwinvar(i, '&previewwindow')
      return i
    endif
  endfor
  return -1
endfunction
