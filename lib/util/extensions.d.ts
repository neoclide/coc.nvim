declare const logger: any;
declare interface Promise<T> {
    /**
     * Catches task error and ignores them.
     */
    logError(): void;
}
