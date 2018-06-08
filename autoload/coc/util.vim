let s:is_win = has("win32") || has('win64')

function! coc#util#get_fullpath(bufnr) abort
  let fname = bufname(a:bufnr)
  if empty(fname) | return '' | endif
  return resolve(fnamemodify(fname, ':p'))
endfunction

function! coc#util#get_buflist() abort
  let buflist = []
  for i in range(tabpagenr('$'))
    call extend(buflist, tabpagebuflist(i + 1))
  endfor
  return buflist
endfunction

function! coc#util#get_filetypes() abort
  let res = []
  for i in range(tabpagenr('$'))
    for bnr in tabpagebuflist(i + 1)
      let filetype = getbufvar(bnr, "&filetype")
      if index(res, filetype) == -1
        call add(res, filetype)
      endif
    endfor
  endfor
  return res
endfunction

function! coc#util#on_error(msg) abort
  echohl Error | echom '[coc.nvim] '.a:msg | echohl None
endfunction

function! coc#util#print_errors(list) abort
  execute 'keepalt below 4new [Sketch File]'
  let lines = copy(a:list)
  call filter(lines, 'v:val !=# ""')
  call setline(1, '[coc.nvim] Error occored:')
  call setline(2, lines[0])
  if len(lines) > 1
    call append(2, lines[1:])
  endif
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

function! coc#util#get_listfile_command() abort
  if exists('g:coc_listfile_command')
    return g:coc_listfile_command
  endif
  if executable('rg')
    return 'rg --color never --files'
  endif
  if executable('ag')
    return 'ag --follow --nogroup --nocolor -g .'
  endif
  return ''
endfunction

" we shuould transfer string to node, it's 10x times faster
function! coc#util#get_content(bufnr) abort
  return join(nvim_buf_get_lines(a:bufnr, 0, -1, v:false), "\n")
endfunction

function! coc#util#preview_info(info) abort
  pclose
  new +setlocal\ previewwindow|setlocal\ buftype=nofile|setlocal\ noswapfile|setlocal\ wrap
  exe "normal z" . &previewheight . "\<cr>"
  call append(0, type(a:info)==type("") ? split(a:info, "\n") : a:info)
  nnoremap <buffer> q :<C-U>bd!<CR>
  wincmd p
endfunction

function! coc#util#get_queryoption() abort
  let [_, lnum, colnr, offset] = getpos('.')
  let dict = {
        \ 'filetype': &filetype,
        \ 'filename': expand('%:p'),
        \ 'col': colnr,
        \ 'lnum': lnum,
        \ 'content': join(getline(1, '$'), "\n"),
        \}
  return dict
endfunction

function! coc#util#jump_to(filepath, lnum, col) abort
  if empty(a:filepath)
    return
  endif
  let lnum = a:lnum + 1
  let col = a:col + 1
  normal! m`
  if a:filepath !=# expand('%:p')
    try
      exec 'keepjumps e ' . fnameescape(a:filepath)
    catch /^Vim\%((\a\+)\)\=:E37/
      " When the buffer is not saved, E37 is thrown.  We can ignore it.
    endtry
  endif
  call cursor(lnum, col)
  normal! zz
endfunction

function! coc#util#get_home()
  if s:is_win
    return $VIM."/vimfiles"
  endif
  return $HOME."/.vim"
endfunction
