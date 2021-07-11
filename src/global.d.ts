declare global {
  namespace NodeJS {
    interface Global {
      __TEST__: boolean
    }
  }
}

export {}
