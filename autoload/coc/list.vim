let s:activated = 0
let s:is_vim = !has('nvim')
let s:saved_ve = &t_ve

function! coc#list#get_chars()
  return {
        \ '<esc>': "\<Esc>",
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
        \ '<bs>': "\<bs>",
        \ '<right>': "\<right>",
        \ '<left>': "\<left>",
        \ '<up>': "\<up>",
        \ '<down>': "\<down>",
        \ '<home>': "\<home>",
        \ '<end>': "\<end>",
        \ '<cr>': "\<cr>",
        \ '<FocusGained>' : "\<FocusGained>",
        \ '<ScrollWheelUp>': "\<ScrollWheelUp>",
        \ '<ScrollWheelDown>': "\<ScrollWheelDown>",
        \ '<LeftMouse>': "\<LeftMouse>",
        \ '<LeftDrag>': "\<LeftDrag>",
        \ '<LeftRelease>': "\<LeftRelease>",
        \ '<2-LeftMouse>': "\<2-LeftMouse>"
        \}
endfunction

function! s:getchar()
  let ch = getchar()
  return (type(ch) == 0 ? nr2char(ch) : ch)
endfunction

function! coc#list#prompt_start()
  call timer_start(0, {-> coc#list#start_prompt()})
endfunction

function! coc#list#start_prompt()
  if s:activated | return | endif
  if s:is_vim
    set t_ve=
  endif
  let s:activated = 1
  try
    while s:activated
      let ch = s:getchar()
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
    call append(line('$'), a:lines)
  else
    call append(0, a:lines)
    call deletebufline('%', len(a:lines) + 1, '$')
  endif
endfunction

function! coc#list#options(...)
  let list = ['--top', '--normal', '--no-sort', '--input', '--strictMatch', '--regex', '--interactive', '--number-select']
  if get(g:, 'coc_enabled', 0)
    let names = coc#rpc#request('listNames', [])
    call extend(list, names)
  endif
  return join(list, "\n")
endfunction

function! coc#list#stop_prompt()
  if s:activated
    let s:activated = 0
    call feedkeys("\u26d4", 'int')
    echo ""
  endif
endfunction

function! coc#list#restore()
  if s:is_vim
    let &t_ve = s:saved_ve
  endif
endfunction

function! coc#list#status(name)
  if !exists('b:list_status') | return '' | endif
  return get(b:list_status, a:name, '')
endfunction

function! coc#list#setup(source)
  setl buftype=nofile filetype=list nobuflisted nofen wrap
  setl number norelativenumber bufhidden=wipe cursorline winfixheight
  setl tabstop=1 nolist
  syntax case ignore
  let source = a:source[7:]
  let name = toupper(source[0]).source[1:]
  execute 'syntax match Coc'.name.'Line /\v^.*$/'
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

function! coc#list#get_colors()
  let color_map = {}
  let colors = ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984']
  let names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  let i = 0
  for color in colors
    let name = names[i]
    let color_map[name] = get(g:, 'terminal_color_'.i, color)
    let i = i + 1
  endfor
  return color_map
endfunction
