let g:coc#_context = {}

function! coc#refresh() abort
    return pumvisible() ? "\<c-e>\<c-r>=coc#start('', 1)\<CR>" : "\<c-r>=coc#start()\<CR>"
endfunction

function! coc#_complete() abort
  call complete(g:coc#_context.start + 1,
      \ g:coc#_context.candidates)
  return ''
endfunction

function! coc#_do_complete() abort
  call feedkeys("\<Plug>_", 'i')
endfunction

function! coc#_hide() abort
  if !pumvisible() | return | endif
  call feedkeys("\<C-e>", 'in')
endfunction

function! coc#_confirm() abort
  call feedkeys("\<C-y>", 'in')
endfunction

function! coc#start(...)
  if !get(g:, 'coc_enabled', 0) 
    call coc#util#on_error('Service not running!')
    return ''
  endif
  let triggerCharacter = get(a:, 1, '')
  let reload = get(a:, 2, 0)
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  let input = pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
  let line = getline('.')
  let opt = {
        \ 'id': localtime(),
        \ 'triggerCharacter': triggerCharacter,
        \ 'changedtick': b:changedtick,
        \ 'word': matchstr(line[l:start : ], '^\k\+'),
        \ 'input': input,
        \ 'line': line,
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%'),
        \ 'reload': reload,
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': l:start,
        \ 'iskeyword': &iskeyword,
        \ 'before': pos[2] == 1 ? '' : line[0:pos[2] - 2]
        \ }
  call CocStart(opt)
  return ''
endfunction

function! coc#prompt_change(count)
  echohl MoreMsg
  echom a:count.' files will be saved. Confirm? (y/n)'
  echohl None
  let confirm = nr2char(getchar()) | redraw!
  if !(confirm ==? "y" || confirm ==? "\r")
    echohl Moremsg | echo 'Cancelled.' | echohl None
    return 0
  end
  return 1
endfunction
