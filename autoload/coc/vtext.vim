let s:is_vim = !has('nvim')
let s:virtual_text_support = has('nvim-0.5.0') || has('patch-9.0.0067')
let s:text_options = has('patch-9.0.0121') || has('nvim-0.6.0')
let s:vim_above = has('patch-9.0.0438')

" This function is called by buffer.setVirtualText
" opts.hl_mode default to 'combine'.
" opts.col vim only, no support on neovim, default to 0.
" opts.virt_text_win_col neovim only.
" opts.text_align could be 'after' 'right' 'below' 'above', converted on neovim.
" opts.text_wrap could be 'wrap' and 'truncate', vim9 only.
" opts.indent add indent when using 'above' and 'below' as text_align
function! coc#vtext#add(bufnr, src_id, line, blocks, opts) abort
  if !s:virtual_text_support
    return
  endif
  let align = get(a:opts, 'text_align', 'after')
  let indent = ''
  if get(a:opts, 'indent', 0)
    let indent = matchstr(getline(a:line + 1), '^\s\+')
  endif
  if s:is_vim
    let column = get(a:opts, 'col', 0)
    if !has_key(a:opts, 'col') && align ==# 'after'
      " add a whitespace, same as neovim.
      let indent = ' '
    endif
    let blocks = a:blocks
    if !empty(a:blocks) && (align ==# 'above' || align ==# 'below')
      " only first highlight can be used
      let hl = a:blocks[0][1]
      let text = join(map(copy(a:blocks), "v:val[0]"), '')
      let blocks = [[text, hl]]
      let column = 0
    endif
    let first = 1
    let base = s:get_option_vim(align, column, get(a:opts, 'text_wrap', 'truncate'))
    for [text, hl] in blocks
      let type = coc#api#create_type(a:src_id, hl, a:opts)
      let opts = extend({ 'text': text, 'type': type }, base)
      if first && !empty(indent)
        let opts['text'] = indent . text
      endif
      call prop_add(a:line + 1, column, opts)
      let first = 0
    endfor
  else
    let opts = { 'hl_mode': get(a:opts, 'hl_mode', 'combine') }
    if s:text_options
      if align ==# 'above' || align ==# 'below'
        let blocks = empty(indent) ? a:blocks : [[indent, 'Normal']] + a:blocks
        let opts['virt_lines'] = [blocks]
        if align ==# 'above'
          let opts['virt_lines_above'] = v:true
        endif
      else
        let opts['virt_text'] = a:blocks
        if align ==# 'right'
          let opts['virt_text_pos'] = 'right_align'
        else
          if type(get(a:opts, 'virt_text_win_col', v:null)) == 0
            let opts['virt_text_win_col'] = a:opts['virt_text_win_col']
            let opts['virt_text_pos'] = 'overlay'
          else
            " default to 'after'
            let opts['virt_text_pos'] = 'eol'
          endif
        endif
      endif
    else
      if has('nvim-0.5.1') && type(get(a:opts, 'virt_text_win_col', v:null)) == 0
        let opts['virt_text_win_col'] = a:opts['virt_text_win_col']
        let opts['virt_text_pos'] = 'overlay'
      endif
    endif
    call nvim_buf_set_extmark(a:bufnr, a:src_id, a:line, 0, opts)
  endif
endfunction

function! s:get_option_vim(align, column, wrap) abort
  let opts = {}
  if s:text_options && a:column == 0
    if a:align ==# 'top' && !s:vim_above
      let opts['text_align'] = 'right'
    else
      let opts['text_align'] = a:align
    endif
    let opts['text_wrap'] = a:wrap
  endif
  return opts
endfunction
