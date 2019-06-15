import { Memento } from '../types';
export default class Memos {
    private filepath;
    constructor(filepath: string);
    private fetchContent;
    private update;
    createMemento(id: string): Memento;
}
