declare module 'et-improve' {

  interface CompileOption {
    debug?: boolean
  }

  type CompileFunc = (data: any, filters?: {[index: string]: Function}, escape?: (input:string) => string) => string

  function compile(template:string, option?: CompileOption): CompileFunc
}
