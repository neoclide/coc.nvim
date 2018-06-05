export default function watchObject<T>(obj: T): {
    watched: T;
    addWatcher: (key: string, cb: (obj: any) => void) => void;
};
