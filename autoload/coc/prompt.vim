let s:is_vim = !has('nvim')
let s:activated = 0
let s:session_names = []
let s:saved_ve = &t_ve
let s:saved_cursor = &guicursor
let s:gui = has('gui_running') || has('nvim')

function! coc#prompt#getc() abort
  let c = getchar()
  return type(c) == type(0) ? nr2char(c) : c
endfunction

function! coc#prompt#getchar() abort
  let input = coc#prompt#getc()
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
    let c = coc#prompt#getc()
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

function! coc#prompt#start_prompt(session) abort
  let s:session_names = s:filter(s:session_names, a:session)
  call add(s:session_names, a:session)
  if s:activated | return | endif
  if s:is_vim
    call s:start_prompt_vim()
  else
    call s:start_prompt()
  endif
endfunction

function! s:start_prompt_vim() abort
  call timer_start(10, {-> s:start_prompt()})
endfunction

function! s:start_prompt()
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
      let ch = coc#prompt#getchar()
      if ch ==# "\u26d4"
        break
      endif
      if ch ==# "\<FocusLost>" || ch ==# "\<FocusGained>" || ch ==# "\<CursorHold>"
        continue
      else
        call coc#rpc#notify('InputChar', [s:current_session(), ch, getcharmod()])
      endif
    endwhile
  catch /^Vim:Interrupt$/
    let s:activated = 0
    call coc#rpc#notify('InputChar', [s:current_session(), "\<esc>"])
    return
  endtry
  let s:activated = 0
endfunction

function! coc#prompt#stop_prompt(session)
  let s:session_names = s:filter(s:session_names, a:session)
  if len(s:session_names)
    return
  endif
  if s:activated
    let s:activated = 0
    if !get(g:, 'coc_disable_transparent_cursor',0)
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
    echo ""
    call feedkeys("\u26d4", 'int')
  endif
endfunction

function! s:current_session() abort
  return s:session_names[len(s:session_names) - 1]
endfunction

function! s:filter(list, id) abort
  return filter(copy(a:list), 'v:val !=# a:id')
endfunction
