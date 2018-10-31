let s:cache = {}

function! coc#source#neosnippet#init() abort
  return {'isSnippet': 1}
endfunction

function! coc#source#neosnippet#should_complete(opt) abort
  if get(g:, 'loaded_neosnippet', 0) == 0 | return 0 | endif
  return 1
endfunction

function! s:get_snippets() abort
  let items = values(neosnippet#helpers#get_completion_snippets())
  let res = []
  for item in items
    call add(res, {
          \ 'word': item['word'],
          \ 'menu': item['menu_abbr'],
          \ 'user_data': get(item, 'user_data', ''),
          \})
  endfor
  return res
endfunction

function! coc#source#neosnippet#on_enter(info) abort
  if !get(g:, 'loaded_neosnippet', 0) | return | endif
  let filetype = get(a:info, 'languageId', '')
  if empty(filetype) | return | endif
  let s:cache[filetype] = s:get_snippets()
endfunction

function! coc#source#neosnippet#complete(opt, cb) abort
  if len(get(a:opt, 'input', '')) == 0
    call a:cb([])
    return
  endif
  let filetype = a:opt['filetype']
  if empty(filetype)
    let items = s:get_snippets()
    call a:cb(items)
    return
  endif
  if !has_key(s:cache, filetype)
    call coc#source#neosnippet#on_enter({
          \ 'languageId': filetype
          \})
  endif
  let items = get(s:cache, filetype, [])
  call a:cb(items)
endfunction

function! coc#source#neosnippet#on_complete(item) abort
  call neosnippet#mappings#expand_impl()
endfunction
