let s:is_vim = !has('nvim')

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

function! coc#list#hide(winid) abort
  call coc#prompt#stop_prompt('list')
  silent! pclose
  if a:winid
    if s:is_vim
      noa call win_execute(winid, 'close!', 'silent!')
    else
      if nvim_win_is_valid(a:winid)
        silent! noa call nvim_win_close(a:winid, 1)
      endif
    endif
  endif
  redraw
endfunction
