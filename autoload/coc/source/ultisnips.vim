
function! coc#source#ultisnips#init() abort
  " user should set the filetypes
  return {
        \'shortcut': 'US',
        \'filetypes': [],
        \'priority': 8,
        \}
endfunction

function! coc#source#ultisnips#complete(opt, cb) abort
  let snips = UltiSnips#SnippetsInCurrentScope()
  if type(snips) == 3
    let items = map(snips, {idx, val -> {'word': val['key'], 'menu': val['description']}})
  else
    let items = map(snips, {key, val -> {'word': key, 'menu': val}})
  endif
  call a:cb(items)
endfunction
