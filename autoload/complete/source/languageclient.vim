
function! complete#source#languageclient#init()
  let filetypes = keys(get(g:, 'LanguageClient_serverCommands', {}))
  let g:f = filetypes
  return {
        \'name': 'languageclient',
        \'shortcut': 'lc',
        \'priority': 9,
        \'filetypes': filetypes,
        \}
endfunction

function! complete#source#languageclient#complete(opt, cb) abort
  let l:Callback = {res -> a:cb(get(res, 'result', []))}
  call LanguageClient#omniComplete({'character': a:opt['col'] - 1}, l:Callback)
endfunction
