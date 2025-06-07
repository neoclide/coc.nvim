let s:is_vim = !has('nvim')

" Add multiple virtual texts, use timer when needed.
" bufnr - The buffer number
" ns - Id created by Nvim_create_namespace()
" items - list of item:
"   item.line - Zero based line number
"   item.blocks - List with [text, hl_group]
"   item.hl_mode - Default to 'combine'.
"   item.col - vim & nvim >= 0.10.0, default to 0.
"   item.virt_text_win_col - neovim only.
"   item.text_align - Could be 'after' 'right' 'below' 'above'.
"   item.text_wrap - Could be 'wrap' and 'truncate', vim9 only.
" indent - Prepend indent of current line when true
" priority - Highlight priority
function! coc#vtext#set(bufnr, ns, items, indent, priority) abort
  try
    if s:is_vim
      call coc#vim9#Set_virtual_texts(a:bufnr, a:ns, a:items, a:indent, a:priority)
    else
      call v:lua.require('coc.vtext').set(a:bufnr, a:ns, a:items, a:indent, a:priority)
    endif
  catch /.*/
    call coc#compat#send_error('coc#vtext#set', s:is_vim)
  endtry
endfunction

" Check virtual text of namespace exists
function! coc#vtext#exists(bufnr, ns) abort
  if s:is_vim
    let types = coc#api#GetNamespaceTypes(a:ns)
    if empty(types)
      return 0
    endif
    return !empty(prop_list(1, {'bufnr': a:bufnr, 'types': types, 'end_lnum': -1}))
  endif
  return !empty(nvim_buf_get_extmarks(a:bufnr, a:ns, [0, 0], [-1, -1], {}))
endfunction

" This function is called by buffer.setVirtualText
" ns - Id created by coc#highlight#create_namespace()
" line - Zero based line number
" blocks - List with [text, hl_group]
" opts.hl_mode - Default to 'combine'.
" opts.col - vim & nvim >= 0.10.0, default to 0.
" opts.virt_text_win_col - neovim only.
" opts.text_align - Could be 'after' 'right' 'below' 'above', converted on neovim.
" opts.text_wrap - Could be 'wrap' and 'truncate', vim9 only.
" opts.indent - add indent when using 'above' and 'below' as text_align
function! coc#vtext#add(bufnr, ns, line, blocks, opts) abort
  try
    if s:is_vim
      call coc#vim9#Add_vtext(a:bufnr, a:ns, a:line, a:blocks, a:opts)
    else
      call v:lua.require('coc.vtext').add(a:bufnr, a:ns, a:line, a:blocks, a:opts)
    endif
  catch /.*/
    call coc#compat#send_error('coc#vtext#add', s:is_vim)
  endtry
endfunction
