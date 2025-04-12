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
    call s:vtext_add(a:bufnr, a:src_id, a:line, a:blocks, a:opts, align, column, indent)
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

def s:vtext_add(
  bufnr: number, src_id: number, line: number, blocks: list<list<string>>, opts: dict<any>,
  align: string, column: number, indent: string
): void
  var propColumn: number = column
  var propIndent: string = indent
  if !has_key(opts, 'col') && align ==# 'after'
    # add a whitespace, same as neovim.
    propIndent = ' '
  endif
  var blockList: list<list<string>> = blocks
  if !empty(blocks) && (align ==# 'above' || align ==# 'below')
    # only first highlight can be used
    const highlightGroup: string = blocks[0][1]
    const text: string = blocks->mapnew((_, block: list<string>): string => block[0])->join('')
    blockList = [[text, highlightGroup]]
    propColumn = 0
  endif
  var first: bool = true
  const base: dict<any> = s:get_option(align, propColumn, get(opts, 'text_wrap', 'truncate'))
  for [text, highlightGroup] in blockList
    const type: string = coc#api#create_type(src_id, highlightGroup, opts)
    final propOpts: dict<any> = extend({ 'text': text, 'type': type, 'bufnr': bufnr }, base)
    if first && !empty(propIndent)
      propOpts['text_padding_left'] = s:calc_padding_size(propIndent)
    endif
    prop_add(line + 1, propColumn, propOpts)
    first = false
  endfor
enddef

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
