
function! coc#source#languageclient#init()
  " user should set the filetypes
  return {
        \'shortcut': 'LC',
        \'filetypes': [],
        \}
endfunction

function! coc#source#languageclient#complete(opt, cb) abort
  " TODO maybe we need to change the character according to specified LanguageServer
  let l:Callback = {res -> a:cb(get(res, 'result', []))}
  call LanguageClient#omniComplete({'character': a:opt['col'] - 1}, l:Callback)
endfunction
