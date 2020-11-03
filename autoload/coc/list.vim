let s:is_vim = !has('nvim')

function! coc#list#get_chars()
  return {
        \ '<plug>': "\<Plug>",
        \ '<esc>': "\<Esc>",
        \ '<tab>': "\<Tab>",
        \ '<s-tab>': "\<S-Tab>",
        \ '<bs>': "\<bs>",
        \ '<right>': "\<right>",
        \ '<left>': "\<left>",
        \ '<up>': "\<up>",
        \ '<down>': "\<down>",
        \ '<home>': "\<home>",
        \ '<end>': "\<end>",
        \ '<cr>': "\<cr>",
        \ '<PageUp>' : "\<PageUp>",
        \ '<PageDown>' : "\<PageDown>",
        \ '<FocusGained>' : "\<FocusGained>",
        \ '<ScrollWheelUp>': "\<ScrollWheelUp>",
        \ '<ScrollWheelDown>': "\<ScrollWheelDown>",
        \ '<LeftMouse>': "\<LeftMouse>",
        \ '<LeftDrag>': "\<LeftDrag>",
        \ '<LeftRelease>': "\<LeftRelease>",
        \ '<2-LeftMouse>': "\<2-LeftMouse>",
        \ '<C-a>': "\<C-a>",
        \ '<C-b>': "\<C-b>",
        \ '<C-c>': "\<C-c>",
        \ '<C-d>': "\<C-d>",
        \ '<C-e>': "\<C-e>",
        \ '<C-f>': "\<C-f>",
        \ '<C-g>': "\<C-g>",
        \ '<C-h>': "\<C-h>",
        \ '<C-i>': "\<C-i>",
        \ '<C-j>': "\<C-j>",
        \ '<C-k>': "\<C-k>",
        \ '<C-l>': "\<C-l>",
        \ '<C-m>': "\<C-m>",
        \ '<C-n>': "\<C-n>",
        \ '<C-o>': "\<C-o>",
        \ '<C-p>': "\<C-p>",
        \ '<C-q>': "\<C-q>",
        \ '<C-r>': "\<C-r>",
        \ '<C-s>': "\<C-s>",
        \ '<C-t>': "\<C-t>",
        \ '<C-u>': "\<C-u>",
        \ '<C-v>': "\<C-v>",
        \ '<C-w>': "\<C-w>",
        \ '<C-x>': "\<C-x>",
        \ '<C-y>': "\<C-y>",
        \ '<C-z>': "\<C-z>",
        \ '<A-a>': "\<A-a>",
        \ '<A-b>': "\<A-b>",
        \ '<A-c>': "\<A-c>",
        \ '<A-d>': "\<A-d>",
        \ '<A-e>': "\<A-e>",
        \ '<A-f>': "\<A-f>",
        \ '<A-g>': "\<A-g>",
        \ '<A-h>': "\<A-h>",
        \ '<A-i>': "\<A-i>",
        \ '<A-j>': "\<A-j>",
        \ '<A-k>': "\<A-k>",
        \ '<A-l>': "\<A-l>",
        \ '<A-m>': "\<A-m>",
        \ '<A-n>': "\<A-n>",
        \ '<A-o>': "\<A-o>",
        \ '<A-p>': "\<A-p>",
        \ '<A-q>': "\<A-q>",
        \ '<A-r>': "\<A-r>",
        \ '<A-s>': "\<A-s>",
        \ '<A-t>': "\<A-t>",
        \ '<A-u>': "\<A-u>",
        \ '<A-v>': "\<A-v>",
        \ '<A-w>': "\<A-w>",
        \ '<A-x>': "\<A-x>",
        \ '<A-y>': "\<A-y>",
        \ '<A-z>': "\<A-z>",
        \}
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
