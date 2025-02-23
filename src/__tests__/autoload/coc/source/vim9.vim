vim9script
export def Init(): dict<any>
  return {
    priority: 9,
    shortcut: 'Email',
    triggerCharacters: ['@']
  }
enddef

export def Complete(option: dict<any>, Callback: func(list<any>))
  const items = ['foo@gmail.com', 'bar@yahoo.com']
  Callback(items)
enddef
