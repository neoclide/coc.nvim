let s:server_file = expand('<sfile>:p:h:h:h:h') . '/bin/jedi_server.py'
let s:job = 0
let s:Callback = v:null
let s:lines = []

function! coc#source#jedi#init() abort
  " user should set the filetypes
  return {
        \'shortcut': 'JD',
        \'filetypes': ['python'],
        \'priority': 8,
        \}
endfunction

function! coc#source#jedi#should_complete(opt) abort
  if a:opt['colnr'] == 0 | return 0 | endif
  return coc#source#jedi#start_server()
endfunction

function! coc#source#jedi#start_server() abort
  if s:job > 0 | return 1| endif
  call system('python -c "import jedi"')
  if v:shell_error
    echohl MoreMsg | echom '[coc.nvim] Can''t load jedi module ' | echohl None
    return 0
  endif
  let s:job = jobstart(['python', s:server_file, '-v'], {
        \ 'on_stdout': {id, data -> s:on_data(data)},
        \ 'on_stderr': {id, data -> coc#util#print_errors(data)},
        \ 'on_exit': {id, code-> s:on_exit(code)},
        \})
  if s:job > 0
    echom '[coc.nvim] jedi service started'
  endif
  return s:job > 0
endfunction

function! coc#source#jedi#complete(opt, cb) abort
  let end = min([line('$'), 1000])
  let line = a:opt['line']
  let col = a:opt['col']
  if line[a:opt['colnr'] - 2] !=# '.'
    " We have to limit the results
    let col = col + 1
  endif
  let s:lines = []
  call chansend(s:job, json_encode({
          \ 'action': 'complete',
          \ 'line': a:opt['linenr'],
          \ 'col': col,
          \ 'filename': expand('%:p'),
          \ 'content': join(getline(1, end), "\n"),
          \})."\n")
  let s:Callback = {lines -> a:cb(json_decode(join(lines)))}
endfunction

function! s:on_data(data)
  call extend(s:lines, a:data)
  if empty(a:data[-1])
    call s:Callback(s:lines)
  endif
endfunction

function! s:on_exit(code)
  if a:code != 0
    call coc#util#err_message('jedi server exit with code '.a:code)
  endif
endfunction
