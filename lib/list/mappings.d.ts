import { Neovim } from '@chemzqm/neovim';
import '../util/extensions';
import ListConfiguration from './configuration';
import { ListManager } from './manager';
export default class Mappings {
    private manager;
    private nvim;
    private config;
    private insertMappings;
    private normalMappings;
    private userInsertMappings;
    private userNormalMappings;
    constructor(manager: ListManager, nvim: Neovim, config: ListConfiguration);
    private fixUserMappings;
    doInsertKeymap(key: string): Promise<boolean>;
    doNormalKeymap(key: string): Promise<boolean>;
    private add;
    private onError;
    private evalExpression;
    private doScroll;
}
