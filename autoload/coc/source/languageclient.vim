
function! coc#source#languageclient#init() abort
  " user should set the filetypes
  return {
        \'shortcut': 'LC',
        \'filetypes': [],
        \'priority': 10,
        \}
endfunction

function! coc#source#languageclient#complete(opt, cb) abort
  " TODO maybe we need to change the character according to specified LanguageServer
  let l:Callback = {res -> a:cb(s:FilterResult(res))}
  call LanguageClient#omniComplete({
        \ 'character': a:opt['col'],
        \ 'line': a:opt['linenr'] - 1,
        \}, l:Callback)
endfunction

function! s:FilterResult(res) abort
  let error = get(a:res, 'error', {})
  if !empty(error)
    let message = get(error, 'message', '')
    echohl Error | echom '[coc.nvim] error from languageclient source: '.message | echohl None
    return []
  endif
  return get(a:res, 'result', [])
endfunction
