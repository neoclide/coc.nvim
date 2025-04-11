vim9script
scriptencoding utf-8

export def WinExecute(): any
  win_execute(win_getid(), 'cursor(1, 1)')
  return v:true
enddef

export def Execute(cmd: string): void
  execute(cmd)
enddef

defcompile
