export default function watchObject<T, K extends keyof T>(obj: T):{watched: T, addWatcher: (key: K, cb: (obj: T[K]) => void) => void} {
  const callbackMap: {[index: string]: (obj: any) => void} = {}
  const handler = {
    get(target: any, property: any, receiver: any):any {
      try {
        return new Proxy(target[property], handler)
      } catch (err) {
        return Reflect.get(target, property, receiver)
      }
    },
    defineProperty(target: any, property: any, descriptor: any):any {
      let fn = callbackMap[property]
      if (fn) {
        fn(descriptor.value)
        delete callbackMap[property]
      }
      return Reflect.defineProperty(target, property, descriptor)
    },
    deleteProperty(target: any, property: any):any {
      return Reflect.deleteProperty(target, property)
    }
  }
  return {
    watched: new Proxy(obj, handler),
    addWatcher(key, cb):void {
      callbackMap[key] = cb
    }
  }
}
