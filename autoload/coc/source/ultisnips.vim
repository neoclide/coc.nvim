
function! coc#source#ultisnips#init() abort
  return {}
endfunction

function! coc#source#ultisnips#should_complete(opt) abort
  if !get(g:, 'did_plugin_ultisnips', 0) | return 0 | endif
  return 1
endfunction

function! coc#source#ultisnips#complete(opt, cb) abort
  let snips = UltiSnips#SnippetsInCurrentScope()
  if type(snips) == 3
    let items = map(snips, {idx, val -> {'word': val['key'], 'dup': 1, 'menu': val['description'], 'filterText': substitute(val['description'], '\s\+', '', 'g')}})
  else
    let items = map(snips, {key, val -> {'word': key, 'dup': 1, 'menu': val}})
  endif
  call a:cb(items)
endfunction
