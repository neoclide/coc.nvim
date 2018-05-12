function! coc#util#get_fullpath(bufnr)
  let fname = bufname(a:bufnr)
  if empty(fname) | return '' | endif
  return fnamemodify(fname, ':p')
endfunction

function! coc#util#get_buflist() abort
  let buflist = []
  for i in range(tabpagenr('$'))
    call extend(buflist, tabpagebuflist(i + 1))
  endfor
  return buflist
endfunction

function! coc#util#print_errors(list) abort
  execute 'keepalt below 4new [Sketch File]'
  let lines = copy(a:list)
  call setline(1, '[coc.nvim] Error occored:')
  call setline(2, lines[0])
  call append(2, lines[1:])
  setl buftype=nofile bufhidden=wipe nobuflisted readonly
endfunction

" make function that only trigger once
function! coc#util#once(callback) abort
  function! Cb(...) dict
    if self.called == 1 | return | endif
    let self.called = 1
    call call(self.fn, a:000)
  endfunction

  let obj = {
        \'called': 0,
        \'fn': a:callback,
        \'callback': funcref('Cb'),
        \}
  return obj['callback']
endfunction

function! coc#util#check_state() abort
  return get(g:, 'coc_node_channel_id', 0)
endfunction
