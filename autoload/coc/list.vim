let s:activated = 0
let s:is_vim = !has('nvim')
let s:saved_ve = &t_ve
let s:saved_cursor = &guicursor
let s:gui = has('gui_running') || has('nvim')

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

function! coc#list#getc() abort
  let c = getchar()
  return type(c) == type(0) ? nr2char(c) : c
endfunction

function! coc#list#getchar() abort
  let input = coc#list#getc()
  if 1 != &iminsert
    return input
  endif
  "a language keymap is activated, so input must be resolved to the mapped values.
  let partial_keymap = mapcheck(input, "l")
  while partial_keymap !=# ""
    let full_keymap = maparg(input, "l")
    if full_keymap ==# "" && len(input) >= 3 "HACK: assume there are no keymaps longer than 3.
      return input
    elseif full_keymap ==# partial_keymap
      return full_keymap
    endif
    let c = coc#list#getc()
    if c ==# "\<Esc>" || c ==# "\<CR>"
      "if the short sequence has a valid mapping, return that.
      if !empty(full_keymap)
        return full_keymap
      endif
      return input
    endif
    let input .= c
    let partial_keymap = mapcheck(input, "l")
  endwhile
  return input
endfunction

function! coc#list#prompt_start() abort
  call timer_start(100, {-> coc#list#start_prompt()})
endfunction

function! coc#list#start_prompt()
  if s:activated | return | endif
  if !get(g:, 'coc_disable_transparent_cursor', 0)
    if s:gui
      if has('nvim-0.5.0') && !empty(s:saved_cursor)
        set guicursor+=a:ver1-CocCursorTransparent/lCursor
      endif
    elseif s:is_vim
      set t_ve=
    endif
  endif
  let s:activated = 1
  try
    while s:activated
      let ch = coc#list#getchar()
      if ch ==# "\u26d4"
        break
      endif
      if ch ==# "\<FocusLost>" || ch ==# "\<FocusGained>" || ch ==# "\<CursorHold>"
        continue
      else
        call coc#rpc#notify('InputChar', [ch, getcharmod()])
      endif
    endwhile
  catch /^Vim:Interrupt$/
    let s:activated = 0
    call coc#rpc#notify('InputChar', ["\<C-c>"])
    return
  endtry
  let s:activated = 0
endfunction

function! coc#list#setlines(lines, append)
  let total = line('$')
  if a:append
    silent call append(line('$'), a:lines)
  else
    silent call append(0, a:lines)
    let n = len(a:lines) + 1
    let saved_reg = @"
    silent execute n.',$d'
    let @" = saved_reg
  endif
endfunction

function! coc#list#options(...)
  let list = ['--top', '--tab', '--normal', '--no-sort', '--input', '--strict',
        \ '--regex', '--interactive', '--number-select', '--auto-preview',
        \ '--ignore-case']
  if get(g:, 'coc_enabled', 0)
    let names = coc#rpc#request('listNames', [])
    call extend(list, names)
  endif
  return join(list, "\n")
endfunction

function! coc#list#stop_prompt(...)
  if get(a:, 1, 0) == 0 && !get(g:, 'coc_disable_transparent_cursor',0)
    " neovim has bug with revert empty &guicursor
    if s:gui && !empty(s:saved_cursor)
      if has('nvim-0.5.0')
        set guicursor+=a:ver1-Cursor/lCursor
        let &guicursor = s:saved_cursor
      endif
    elseif s:is_vim
      let &t_ve = s:saved_ve
    endif
  endif
  if s:activated
    let s:activated = 0
    call feedkeys("\u26d4", 'int')
  endif
endfunction

function! coc#list#status(name)
  if !exists('b:list_status') | return '' | endif
  return get(b:list_status, a:name, '')
endfunction

function! coc#list#create(position, height, name, numberSelect)
  nohlsearch
  if a:position ==# 'tab'
    execute 'silent tabe list:///'.a:name
  else
    execute 'silent keepalt '.(a:position ==# 'top' ? '' : 'botright').a:height.'sp list:///'.a:name
    execute 'resize '.a:height
  endif
  if a:numberSelect
    setl number
  else
    setl nonumber
    setl foldcolumn=2
  endif
  return [bufnr('%'), win_getid()]
endfunction

function! coc#list#setup(source)
  let b:list_status = {}
  let statusParts = [
    \ '%#CocListMode#-- %{get(b:list_status, "mode")} --%*',
    \ '%{get(g:, "coc_list_loading_status", "")}',
    \ '%{get(b:list_status, "args", "")}',
    \ '(%L/%{get(b:list_status, "total", "")})',
    \ '%=',
    \ '%#CocListPath# %{get(b:list_status, "cwd", "")} %l/%L%*'
    \ ]
  call setwinvar(winnr(), '&statusline', join(statusParts, ' '))
  setl buftype=nofile nobuflisted nofen nowrap
  setl norelativenumber bufhidden=wipe cursorline winfixheight
  setl tabstop=1 nolist nocursorcolumn
  setl signcolumn=auto
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
