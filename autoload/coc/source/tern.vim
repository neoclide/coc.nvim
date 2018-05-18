let s:server_file = expand('<sfile>:p:h:h:h:h') . '/bin/tern.js'
let s:job = 0
let s:Callback = v:null

function! coc#source#tern#init() abort
  " user should set the filetypes
  return {
        \'shortcut': 'TERN',
        \'filetypes': ['javascript'],
        \'priority': 8,
        \}
endfunction

function! coc#source#tern#should_complete(opt) abort
  if a:opt['colnr'] == 0 | return 0 | endif
  return coc#source#tern#start_server()
endfunction

function! coc#source#tern#start_server() abort
  if s:job > 0 | return 1| endif
  let l:err = []
  let s:job = jobstart(['node', s:server_file], {
        \ 'rpc': v:true,
        \ 'on_stderr': {id, data -> extend(l:err, data)},
        \ 'on_exit': {id, code-> s:on_exit(code, l:err)},
        \})
  if s:job > 0
    echom '[coc.nvim] tern service started'
  endif
  return s:job > 0
endfunction

function! coc#source#tern#complete(opt, cb) abort
  let end = min([line('$'), 1000])
  let line = a:opt['line']
  let col = a:opt['col']
  if line[a:opt['colnr'] - 2] !=# '.'
    " We have to limit the results
    let col = col + 1
  endif
  let chan_id = get(g:, 'coc_tern_chan_id', 0)
  if chan_id
    call rpcnotify(chan_id, 'complete', {
          \ 'filename': a:opt['filepath'],
          \ 'line': a:opt['linenr'] - 1,
          \ 'col': col,
          \ 'content': join(getline(1, '$'), "\n"),
          \})
    let s:Callback = {items -> a:cb(items)}
  endif
endfunction

function! coc#source#tern#set_results(items) abort
  call s:Callback(a:items)
endfunction

function! s:on_exit(code, errs)
  let s:job = 0
  let s:Callback = v:null
  if a:code != 0
    call coc#util#err_message('tern server exit with code '.a:code)
    if !empty(a:errs)
      call coc#util#print_errors(a:errs)
    endif
  endif
endfunction
