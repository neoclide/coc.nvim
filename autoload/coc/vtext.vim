let s:is_vim = !has('nvim')
let s:n10 = has('nvim-0.10.0')

" This function is called by buffer.setVirtualText
" bufnr - The buffer number
" src_id - Id created by coc#highlight#create_namespace()
" line - Zero based line number
" blocks - List with [text, hl_group]
" opts.hl_mode - Default to 'combine'.
" opts.col - vim & nvim >= 0.10.0, default to 0.
" opts.virt_text_win_col - neovim only.
" opts.text_align - Could be 'after' 'right' 'below' 'above', converted on neovim.
" opts.text_wrap - Could be 'wrap' and 'truncate', vim9 only.
" opts.indent - add indent when using 'above' and 'below' as text_align
function! coc#vtext#add(bufnr, src_id, line, blocks, opts) abort
  let align = get(a:opts, 'text_align', 'after')
  let column = get(a:opts, 'col', 0)
  let indent = ''
  if get(a:opts, 'indent', 0)
    let indent = matchstr(get(getbufline(a:bufnr, a:line + 1), 0, ''), '^\s\+')
  endif
  if s:is_vim
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
    let base = s:get_option(align, column, get(a:opts, 'text_wrap', 'truncate'))
    for [text, hl] in blocks
      let type = coc#api#create_type(a:src_id, hl, a:opts)
      let opts = extend({ 'text': text, 'type': type, 'bufnr': a:bufnr }, base)
      if first && !empty(indent)
        let opts['text_padding_left'] = s:calc_padding_size(indent)
      endif
      call prop_add(a:line + 1, column, opts)
      let first = 0
    endfor
  else
    let opts = { 'hl_mode': get(a:opts, 'hl_mode', 'combine') }
    if align ==# 'above' || align ==# 'below'
      let blocks = empty(indent) ? a:blocks : [[indent, 'Normal']] + a:blocks
      let opts['virt_lines'] = [blocks]
      if align ==# 'above'
        let opts['virt_lines_above'] = v:true
      endif
    else
      let opts['virt_text'] = a:blocks
      let opts['right_gravity'] = get(a:opts, 'right_gravity', v:true)
      if s:n10 && column != 0
        let opts['virt_text_pos'] = 'inline'
      elseif align ==# 'right'
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
    let col = s:n10 ? column - 1 : 0
    call nvim_buf_set_extmark(a:bufnr, a:src_id, a:line, col, opts)
  endif
endfunction

if !s:is_vim
  finish
endif

def s:get_option(text_align: string, column: number, text_wrap: string): dict<any>
  if column == 0
    return {
      'text_align': text_align,
      'text_wrap': text_wrap,
    }
  endif
  return {}
enddef

def s:calc_padding_size(indent: string): number
  const tabSize: number = &shiftwidth ?? &tabstop
  var padding: number = 0
  for character in indent
    if character == "\t"
      padding += tabSize - (padding % tabSize)
    else
      padding += 1
    endif
  endfor
  return padding
enddef
