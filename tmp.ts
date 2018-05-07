import { TextDocument, TextEdit } from 'vscode-languageserver-types'

let contents = 'abnc fw fewfff ffffffffffffffffe ffffffffef'
let s = '[\\wÀ-ÿ]{3,}'
console.log(s)
let re = new RegExp(s, 'g')
console.log(contents.match(re))
