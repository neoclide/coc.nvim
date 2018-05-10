let g:complete#_context = {}

" private
function! complete#get_config(...)
  return {
        \ 'completeOpt': &completeopt,
        \ 'fuzzyMatch': get(g:, 'complete_fuzzy_match', v:null),
        \ 'traceError': get(g:, 'complete_trace_error', v:null),
        \ 'timeout': get(g:, 'complete_timeout', v:null),
        \ 'checkGit': get(g:, 'complete_ignore_git_ignore', v:null),
        \ 'disabled': get(g:, 'complete_source_disabled', v:null),
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
  if !get(g:, 'complete_enabled', 0) | return '' | endif
  let resume = get(a:, 1, 0)
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  let input = line[l:start : pos[2] - 2]
  let opt = {
        \ 'id': localtime(),
        \ 'word': matchstr(line[l:start : ], '^\k\+'),
        \ 'input': input,
        \ 'line': getline('.'),
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%').'',
        \ 'lnum': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': l:start,
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
