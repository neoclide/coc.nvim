let s:activated = 0

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
        \}
endfunction

function! s:getchar()
  let ch = getchar()
  return (type(ch) == 0 ? nr2char(ch) : ch)
endfunction

function! coc#list#start_prompt()
  if s:activated | return | endif
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
    call feedkeys("\u26d4", 'in')
    echo ""
    redraw
  endif
  let s:activated = 0
endfunction

function! coc#list#status(name)
  if !exists('b:list_status') | return '' | endif
  return get(b:list_status, a:name, '')
endfunction

function! coc#list#setup(source)
  setl buftype=nofile filetype=list nobuflisted nofen nowrap
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
