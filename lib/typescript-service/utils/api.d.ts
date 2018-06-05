export default class API {
    readonly versionString: string;
    private readonly version;
    static readonly defaultVersion: API;
    private constructor();
    static fromVersionString(versionString: string): API;
    has203Features(): boolean;
    has206Features(): boolean;
    has208Features(): boolean;
    has213Features(): boolean;
    has220Features(): boolean;
    has222Features(): boolean;
    has230Features(): boolean;
    has234Features(): boolean;
    has240Features(): boolean;
    has250Features(): boolean;
    has260Features(): boolean;
    has262Features(): boolean;
    has270Features(): boolean;
    has280Features(): boolean;
    has290Features(): boolean;
}
