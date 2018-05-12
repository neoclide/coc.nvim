let g:coc#_context = {}

" private
function! coc#get_config(...)
  return {
        \ 'completeOpt': &completeopt,
        \ 'fuzzyMatch': get(g:, 'coc_fuzzy_match', v:null),
        \ 'traceError': get(g:, 'coc_trace_error', v:null),
        \ 'timeout': get(g:, 'coc_timeout', v:null),
        \ 'checkGit': get(g:, 'coc_ignore_git_ignore', v:null),
        \ 'disabled': get(g:, 'coc_source_disabled', v:null),
        \}
endfunction

function! coc#refresh() abort
    return coc#menu_selected() ? "\<c-y>\<c-r>=coc#start()\<CR>" : "\<c-r>=coc#start()\<CR>"
endfunction

function! coc#_complete() abort
  call complete(g:coc#_context.start + 1,
      \ g:coc#_context.candidates)
  return ''
endfunction

function! coc#_do_complete() abort
  call feedkeys("\<Plug>_", 'i')
endfunction

function! coc#start()
  if !get(g:, 'coc_enabled', 0) 
    echohl Error | echon '[coc.nvim] Service disabled' | echohl None
    return 
  endif
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  let input = line[l:start : pos[2] - 2]
  let opt = {
        \ 'id': localtime(),
        \ 'changedtick': b:changedtick,
        \ 'word': matchstr(line[l:start : ], '^\k\+'),
        \ 'input': input,
        \ 'line': getline('.'),
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%').'',
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': l:start,
        \ }
  call CocStart(opt)
  return ''
endfunction

function! coc#menu_selected() abort
    return pumvisible() && !empty(v:completed_item)
endfunction
