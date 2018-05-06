let g:complete#_context = {}

function! complete#get_config(...)
  return {
        \ 'fuzzyMatch': get(g:, 'complete_fuzzy_match', v:null),
        \ 'noTrace': get(g:, 'complete_no_trace', v:null),
        \ 'timeout': get(g:, 'complete_timeout', v:null),
        \ 'sources': get(g:, 'complete_sources', v:null)
        \}
endfunction

function! complete#refresh() abort
    return complete#menu_selected() ? "\<c-y>\<c-r>=complete#start()\<CR>" : "\<c-r>=complete#start()\<CR>"
endfunction

function! complete#_complete() abort
  call complete(g:complete#_context.start + 1,
      \ g:complete#_context.candidates)
  return ''
endfunction

function! complete#_do_complete() abort
  call feedkeys("\<Plug>_", 'i')
endfunction

function! complete#start(...)
  let resume = get(a:, 1, 0)
  let pos = getcurpos()
  let line = getline('.')
  let start = pos[2] - 1
  while start > 0 && line[start - 1] =~# '\k'
    let start -= 1
  endwhile
  let input = line[start : pos[2] - 2]
  let opt = {
        \ 'word': matchstr(line[start:], '^\k\+'),
        \ 'input': input,
        \ 'line': getline('.'),
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'bufnr': bufnr('%'),
        \ 'lnum': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': start,
        \ }
  if resume
    call CompleteResume(opt)
  else
    call CompleteStart(opt)
  endif
  return ''
endfunction

function! complete#menu_selected() abort
    return pumvisible() && !empty(v:completed_item)
endfunction

function! s:GetCompletionCol(line, col)
  let pos = getcurpos()
  if pos[2] < 2 | return -1 | endif
  let content = a:line[0:pos[2] - 2]
  " find the last none keyword character column
  return len(substitute(content, '\k\+$', '', ''))
endfunction

function! complete#disable()
  augroup complete_nvim
    autocmd!
  augroup end
  echohl MoreMsg
    echon 'complete.nvim disabled'
  echohl None
endfunction

