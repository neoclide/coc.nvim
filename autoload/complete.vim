" ============================================================================
" Description: handler main logic of vim side
" Author: Qiming Zhao <chemzqm@gmail.com>
" Licence: MIT licence
" Version: 0.1
" Last Modified:  May 03, 2018
" ============================================================================

let g:complete#_context = {}

function! complete#get_config(...)
  return {
        \ 'fuzzyMatch': get(g:, 'complete_fuzzy_match', v:null),
        \ 'keywordsRegex': get(g:, 'complete_keywords_regex', v:null),
        \ 'noTrace': get(g:, 'complete_no_trace', v:null),
        \ 'timeout': get(g:, 'complete_timeout', v:null),
        \ 'source': get(g:, 'complete_sources', v:null)
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

function! complete#start()
  let pos = getcurpos()
  let line = getline('.')
  let start = pos[2] - 1
  while start > 0 && line[start - 1] =~# '\w'
    let start -= 1
  endwhile
  let input = line[start : pos[2] - 2]
  call CompleteStart({
        \ 'word': expand('<cword>'),
        \ 'input': input,
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'bufnr': bufnr('%'),
        \ 'lnum': pos[1],
        \ 'col': start,
        \})
  return ''
endfunction

" run complete for a specified source
function! complete#complete_source(name, opt)
  let handler = 'complete#source#'.a:name.'#complete'
  if !exists('*'.handler)
    echoerr 'complete handler not found from source '.a:name
    return
  endif
  " TODO
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


