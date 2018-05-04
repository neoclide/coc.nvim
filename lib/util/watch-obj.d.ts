export default function watchObject<T, K extends keyof T>(obj: T): {
    watched: T;
    addWatcher: (key: K, cb: (obj: T[K]) => void) => void;
};
