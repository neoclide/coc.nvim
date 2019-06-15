export default class Resolver {
    private readonly nodeFolder;
    private readonly yarnFolder;
    resolveModule(mod: string): Promise<string>;
}
