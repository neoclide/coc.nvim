"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const vscode_uri_1 = require("vscode-uri");
const events_1 = tslib_1.__importDefault(require("../../events"));
const types_1 = require("../../types");
const util_1 = require("../../util");
const fs_2 = require("../../util/fs");
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const helper_1 = tslib_1.__importStar(require("../helper"));
let nvim;
let disposables = [];
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
    util_1.disposeAll(disposables);
    disposables = [];
});
describe('workspace properties', () => {
    it('should have initialized', () => {
        let { nvim, workspaceFolders, channelNames, rootPath, cwd, documents, initialized, textDocuments } = workspace_1.default;
        expect(nvim).toBeTruthy();
        expect(initialized).toBe(true);
        expect(channelNames.length).toBe(0);
        expect(documents.length).toBe(1);
        expect(textDocuments.length).toBe(1);
        expect(rootPath).toBe(process.cwd());
        expect(cwd).toBe(process.cwd());
        expect(workspaceFolders.length).toBe(0);
    });
    it('should add workspaceFolder', async () => {
        await helper_1.default.edit();
        let { workspaceFolders, workspaceFolder } = workspace_1.default;
        expect(workspaceFolders.length).toBe(1);
        expect(workspaceFolders[0].name).toBe('coc.nvim');
        expect(workspaceFolder.name).toBe('coc.nvim');
    });
    it('should check isVim and isNvim', async () => {
        let { isVim, isNvim } = workspace_1.default;
        expect(isVim).toBe(false);
        expect(isNvim).toBe(true);
    });
    it('should return plugin root', () => {
        let { pluginRoot } = workspace_1.default;
        expect(pluginRoot).toBe(process.cwd());
    });
    it('should ready', async () => {
        workspace_1.default._initialized = false;
        let p = workspace_1.default.ready;
        workspace_1.default._initialized = true;
        workspace_1.default._onDidWorkspaceInitialized.fire(void 0);
        await p;
    });
    it('should get filetyps', async () => {
        await helper_1.default.edit('f.js');
        let filetypes = workspace_1.default.filetypes;
        expect(filetypes.has('javascript')).toBe(true);
    });
});
describe('workspace applyEdits', () => {
    it('should apply TextEdit of documentChanges', async () => {
        let doc = await helper_1.default.createDocument();
        let versioned = vscode_languageserver_types_1.VersionedTextDocumentIdentifier.create(doc.uri, doc.version);
        let edit = vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'bar');
        let change = vscode_languageserver_types_1.TextDocumentEdit.create(versioned, [edit]);
        let workspaceEdit = {
            documentChanges: [change]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(true);
        let line = await nvim.getLine();
        expect(line).toBe('bar');
    });
    it('should not apply TextEdit if version miss match', async () => {
        let doc = await helper_1.default.createDocument();
        let versioned = vscode_languageserver_types_1.VersionedTextDocumentIdentifier.create(doc.uri, 10);
        let edit = vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'bar');
        let change = vscode_languageserver_types_1.TextDocumentEdit.create(versioned, [edit]);
        let workspaceEdit = {
            documentChanges: [change]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(false);
    });
    it('should apply edits with changes to buffer', async () => {
        let doc = await helper_1.default.createDocument();
        let changes = {
            [doc.uri]: [vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'bar')]
        };
        let workspaceEdit = { changes };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(true);
        let line = await nvim.getLine();
        expect(line).toBe('bar');
    });
    it('should apply edits with changes to file not in buffer list', async () => {
        let filepath = await helper_1.createTmpFile('bar');
        let uri = vscode_uri_1.URI.file(filepath).toString();
        let changes = {
            [uri]: [vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'foo')]
        };
        let res = await workspace_1.default.applyEdit({ changes });
        expect(res).toBe(true);
        let doc = workspace_1.default.getDocument(uri);
        let content = doc.getDocumentContent();
        expect(content).toMatch(/^foobar/);
        await nvim.command('silent! %bwipeout!');
    });
    it('should apply edits when file not exists', async () => {
        let filepath = path_1.default.join(__dirname, 'not_exists');
        let uri = vscode_uri_1.URI.file(filepath).toString();
        let changes = {
            [uri]: [vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'foo')]
        };
        let res = await workspace_1.default.applyEdit({ changes });
        expect(res).toBe(true);
    });
    it('should return false for change to file not exists', async () => {
        let uri = vscode_uri_1.URI.file('/tmp/not_exists').toString();
        let versioned = vscode_languageserver_types_1.VersionedTextDocumentIdentifier.create(uri, null);
        let edit = vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'bar');
        let documentChanges = [vscode_languageserver_types_1.TextDocumentEdit.create(versioned, [edit])];
        let res = await workspace_1.default.applyEdit({ documentChanges });
        expect(res).toBe(false);
    });
    it('should adjust cursor position after applyEdits', async () => {
        let doc = await helper_1.default.createDocument();
        let pos = await workspace_1.default.getCursorPosition();
        expect(pos).toEqual({ line: 0, character: 0 });
        let edit = vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'foo\n');
        let versioned = vscode_languageserver_types_1.VersionedTextDocumentIdentifier.create(doc.uri, null);
        let documentChanges = [vscode_languageserver_types_1.TextDocumentEdit.create(versioned, [edit])];
        let res = await workspace_1.default.applyEdit({ documentChanges });
        expect(res).toBe(true);
        pos = await workspace_1.default.getCursorPosition();
        expect(pos).toEqual({ line: 1, character: 0 });
    });
    it('should support null version of documentChanges', async () => {
        let file = path_1.default.join(__dirname, 'foo');
        await workspace_1.default.createFile(file, { ignoreIfExists: true, overwrite: true });
        let uri = vscode_uri_1.URI.file(file).toString();
        let versioned = vscode_languageserver_types_1.VersionedTextDocumentIdentifier.create(uri, null);
        let edit = vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'bar');
        let change = vscode_languageserver_types_1.TextDocumentEdit.create(versioned, [edit]);
        let workspaceEdit = {
            documentChanges: [change]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(true);
        await nvim.command('wa');
        let content = await fs_2.readFile(file, 'utf8');
        expect(content).toMatch(/^bar/);
        await workspace_1.default.deleteFile(file, { ignoreIfNotExists: true });
    });
    it('should support CreateFile edit', async () => {
        let file = path_1.default.join(__dirname, 'foo');
        let uri = vscode_uri_1.URI.file(file).toString();
        let workspaceEdit = {
            documentChanges: [vscode_languageserver_types_1.CreateFile.create(uri, { overwrite: true })]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(true);
        await workspace_1.default.deleteFile(file, { ignoreIfNotExists: true });
    });
    it('should support DeleteFile edit', async () => {
        let file = path_1.default.join(__dirname, 'foo');
        await workspace_1.default.createFile(file, { ignoreIfExists: true, overwrite: true });
        let uri = vscode_uri_1.URI.file(file).toString();
        let workspaceEdit = {
            documentChanges: [vscode_languageserver_types_1.DeleteFile.create(uri)]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(true);
    });
    it('should check uri for CreateFile edit', async () => {
        let workspaceEdit = {
            documentChanges: [vscode_languageserver_types_1.CreateFile.create('term://.', { overwrite: true })]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(false);
    });
    it('should support RenameFile edit', async () => {
        let file = path_1.default.join(__dirname, 'foo');
        await workspace_1.default.createFile(file, { ignoreIfExists: true, overwrite: true });
        let newFile = path_1.default.join(__dirname, 'bar');
        let uri = vscode_uri_1.URI.file(file).toString();
        let workspaceEdit = {
            documentChanges: [vscode_languageserver_types_1.RenameFile.create(uri, vscode_uri_1.URI.file(newFile).toString())]
        };
        let res = await workspace_1.default.applyEdit(workspaceEdit);
        expect(res).toBe(true);
        await workspace_1.default.deleteFile(newFile, { ignoreIfNotExists: true });
    });
});
describe('workspace methods', () => {
    it('should get the document', async () => {
        let buf = await helper_1.default.edit();
        await helper_1.default.wait(100);
        let doc = workspace_1.default.getDocument(buf.id);
        expect(doc.buffer.equals(buf)).toBeTruthy();
        doc = workspace_1.default.getDocument(doc.uri);
        expect(doc.buffer.equals(buf)).toBeTruthy();
    });
    it('should get offset', async () => {
        let buf = await nvim.buffer;
        await buf.setLines(['foo', 'bar'], { start: 0, end: -1 });
        await helper_1.default.wait(100);
        await nvim.call('cursor', [2, 2]);
        let n = await workspace_1.default.getOffset();
        expect(n).toBe(5);
    });
    it('should get format options', async () => {
        let opts = await workspace_1.default.getFormatOptions();
        expect(opts.insertSpaces).toBe(true);
        expect(opts.tabSize).toBe(2);
    });
    it('should get format options of current buffer', async () => {
        let buf = await helper_1.default.edit();
        await buf.setOption('shiftwidth', 8);
        await buf.setOption('expandtab', false);
        let doc = workspace_1.default.getDocument(buf.id);
        let opts = await workspace_1.default.getFormatOptions(doc.uri);
        expect(opts.insertSpaces).toBe(false);
        expect(opts.tabSize).toBe(8);
    });
    it('should get format options when uri not exists', async () => {
        let uri = vscode_uri_1.URI.file('/tmp/foo').toString();
        let opts = await workspace_1.default.getFormatOptions(uri);
        expect(opts.insertSpaces).toBe(true);
        expect(opts.tabSize).toBe(2);
    });
    it('should get config files', async () => {
        let file = workspace_1.default.getConfigFile(types_1.ConfigurationTarget.Global);
        expect(file).toBeFalsy();
        file = workspace_1.default.getConfigFile(types_1.ConfigurationTarget.User);
        expect(file).toBeTruthy();
    });
    it('should create file watcher', async () => {
        let watcher = workspace_1.default.createFileSystemWatcher('**/*.ts');
        expect(watcher).toBeTruthy();
    });
    it('should get quickfix item from Location', async () => {
        let filepath = await helper_1.createTmpFile('quickfix');
        let uri = vscode_uri_1.URI.file(filepath).toString();
        let p = vscode_languageserver_types_1.Position.create(0, 0);
        let loc = vscode_languageserver_types_1.Location.create(uri, vscode_languageserver_types_1.Range.create(p, p));
        let item = await workspace_1.default.getQuickfixItem(loc);
        expect(item.filename).toBe(filepath);
        expect(item.text).toBe('quickfix');
    });
    it('should get line of document', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('abc');
        let line = await workspace_1.default.getLine(doc.uri, 0);
        expect(line).toBe('abc');
    });
    it('should get line of file', async () => {
        let filepath = await helper_1.createTmpFile('quickfix');
        let uri = vscode_uri_1.URI.file(filepath).toString();
        let line = await workspace_1.default.getLine(uri, 0);
        expect(line).toBe('quickfix');
    });
    it('should echo lines', async () => {
        await workspace_1.default.echoLines(['a', 'b']);
        await helper_1.default.wait(30);
        let ch = await nvim.call('screenchar', [79, 1]);
        let s = String.fromCharCode(ch);
        expect(s).toBe('a');
    });
    it('should echo multiple lines with truncate', async () => {
        await workspace_1.default.echoLines(['a', 'b', 'd', 'e'], true);
        let ch = await nvim.call('screenchar', [79, 1]);
        let s = String.fromCharCode(ch);
        expect(s).toBe('a');
    });
    it('should read content from buffer', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('foo');
        await helper_1.default.wait(100);
        let line = await workspace_1.default.readFile(doc.uri);
        expect(line).toBe('foo\n');
    });
    it('should read content from file', async () => {
        let filepath = await helper_1.createTmpFile('content');
        let content = await workspace_1.default.readFile(vscode_uri_1.URI.file(filepath).toString());
        expect(content).toBe(content);
    });
    it('should get current document', async () => {
        let buf = await helper_1.default.edit('foo');
        let doc = await workspace_1.default.document;
        expect(doc.bufnr).toBe(buf.id);
        buf = await helper_1.default.edit('tmp');
        doc = await workspace_1.default.document;
        expect(doc.bufnr).toBe(buf.id);
    });
    it('should run command', async () => {
        let res = await workspace_1.default.runCommand('ls', __dirname, 1);
        expect(res).toMatch('workspace');
    });
    it('should run terminal command', async () => {
        let res = await workspace_1.default.runTerminalCommand('ls', __dirname);
        expect(res.success).toBe(true);
    });
    it('should show mesages', async () => {
        await helper_1.default.edit();
        workspace_1.default.showMessage('error', 'error');
        await helper_1.default.wait(30);
        let str = await helper_1.default.getCmdline();
        expect(str).toMatch('error');
        workspace_1.default.showMessage('warning', 'warning');
        await helper_1.default.wait(30);
        str = await helper_1.default.getCmdline();
        expect(str).toMatch('warning');
        workspace_1.default.showMessage('moremsg');
        await helper_1.default.wait(30);
        str = await helper_1.default.getCmdline();
        expect(str).toMatch('moremsg');
    });
    it('should resolve module path if exists', async () => {
        let res = await workspace_1.default.resolveModule('typescript');
        expect(res).toBeTruthy();
    });
    it('should not resolve module if not exists', async () => {
        let res = await workspace_1.default.resolveModule('foo');
        expect(res).toBeFalsy();
    });
    it('should return match score for document', async () => {
        let doc = await helper_1.default.createDocument('tmp.xml');
        expect(workspace_1.default.match(['xml'], doc.textDocument)).toBe(10);
        expect(workspace_1.default.match(['wxml'], doc.textDocument)).toBe(0);
        expect(workspace_1.default.match([{ language: 'xml' }], doc.textDocument)).toBe(10);
        expect(workspace_1.default.match([{ language: 'wxml' }], doc.textDocument)).toBe(0);
        expect(workspace_1.default.match([{ pattern: '**/*.xml' }], doc.textDocument)).toBe(5);
        expect(workspace_1.default.match([{ pattern: '**/*.html' }], doc.textDocument)).toBe(0);
        expect(workspace_1.default.match([{ scheme: 'file' }], doc.textDocument)).toBe(5);
        expect(workspace_1.default.match([{ scheme: 'term' }], doc.textDocument)).toBe(0);
        expect(workspace_1.default.match([{ language: 'xml' }, { scheme: 'file' }], doc.textDocument)).toBe(10);
    });
    it('should create terminal', async () => {
        let terminal = await workspace_1.default.createTerminal({ name: 'test' });
        let pid = await terminal.processId;
        expect(typeof pid == 'number').toBe(true);
        terminal.dispose();
    });
    it('should rename buffer', async () => {
        await nvim.command('edit a');
        await helper_1.default.wait(100);
        let p = workspace_1.default.renameCurrent();
        await helper_1.default.wait(100);
        await nvim.input('<backspace>b<cr>');
        await p;
        let name = await nvim.eval('bufname("%")');
        expect(name.endsWith('b')).toBe(true);
    });
    it('should rename file', async () => {
        let cwd = await nvim.call('getcwd');
        let file = path_1.default.join(cwd, 'a');
        fs_1.default.writeFileSync(file, 'foo', 'utf8');
        await nvim.command('edit a');
        await helper_1.default.wait(100);
        let p = workspace_1.default.renameCurrent();
        await helper_1.default.wait(100);
        await nvim.input('<backspace>b<cr>');
        await p;
        let name = await nvim.eval('bufname("%")');
        expect(name.endsWith('b')).toBe(true);
        expect(fs_1.default.existsSync(path_1.default.join(cwd, 'b'))).toBe(true);
        fs_1.default.unlinkSync(path_1.default.join(cwd, 'b'));
    });
});
describe('workspace utility', () => {
    it('should loadFile', async () => {
        let doc = await helper_1.default.createDocument();
        let newFile = vscode_uri_1.URI.file(path_1.default.join(__dirname, 'abc')).toString();
        let document = await workspace_1.default.loadFile(newFile);
        let bufnr = await nvim.call('bufnr', '%');
        expect(document.uri.endsWith('abc')).toBe(true);
        expect(bufnr).toBe(doc.bufnr);
    });
    it('should not create file if document exists', async () => {
        let doc = await helper_1.default.createDocument();
        let filepath = vscode_uri_1.URI.parse(doc.uri).fsPath;
        await workspace_1.default.createFile(filepath, { ignoreIfExists: false });
        let exists = fs_1.default.existsSync(filepath);
        expect(exists).toBe(false);
    });
    it('should not create file if file exists with ignoreIfExists', async () => {
        let file = await helper_1.createTmpFile('foo');
        await workspace_1.default.createFile(file, { ignoreIfExists: true });
        let content = fs_1.default.readFileSync(file, 'utf8');
        expect(content).toBe('foo');
    });
    it('should create file if not exists', async () => {
        let filepath = path_1.default.join(__dirname, 'foo');
        await workspace_1.default.createFile(filepath, { ignoreIfExists: true });
        let exists = fs_1.default.existsSync(filepath);
        expect(exists).toBe(true);
        fs_1.default.unlinkSync(filepath);
    });
    it('should create folder if not exists', async () => {
        let filepath = path_1.default.join(__dirname, 'bar/');
        await workspace_1.default.createFile(filepath);
        expect(fs_1.default.existsSync(filepath)).toBe(true);
        fs_1.default.rmdirSync(filepath);
    });
    it('should not throw on folder create if overwrite is true', async () => {
        let filepath = path_1.default.join(__dirname, 'bar/');
        await workspace_1.default.createFile(filepath);
        await workspace_1.default.createFile(filepath, { overwrite: true });
        expect(fs_1.default.existsSync(filepath)).toBe(true);
        fs_1.default.rmdirSync(filepath);
    });
    it('should rename if file not exists', async () => {
        let filepath = path_1.default.join(__dirname, 'foo');
        let newPath = path_1.default.join(__dirname, 'bar');
        await workspace_1.default.createFile(filepath);
        await workspace_1.default.renameFile(filepath, newPath);
        expect(fs_1.default.existsSync(newPath)).toBe(true);
        expect(fs_1.default.existsSync(filepath)).toBe(false);
        fs_1.default.unlinkSync(newPath);
    });
    it('should rename buffer when necessary', async () => {
        let filepath = path_1.default.join(__dirname, 'old');
        await fs_2.writeFile(filepath, 'bar');
        let uri = vscode_uri_1.URI.file(filepath).toString();
        await workspace_1.default.openResource(uri);
        await helper_1.default.wait(100);
        let line = await nvim.line;
        expect(line).toBe('bar');
        let newFile = path_1.default.join(__dirname, 'new');
        let newUri = vscode_uri_1.URI.file(newFile).toString();
        await workspace_1.default.renameFile(filepath, newFile, { overwrite: true });
        await helper_1.default.wait(100);
        let old = workspace_1.default.getDocument(uri);
        expect(old).toBeNull();
        let doc = workspace_1.default.getDocument(newUri);
        expect(doc.uri).toBe(newUri);
        await nvim.setLine('foo');
        await helper_1.default.wait(30);
        let content = doc.getDocumentContent();
        expect(content).toMatch('foo');
        fs_1.default.unlinkSync(newFile);
    });
    it('should overwrite if file exists', async () => {
        let filepath = path_1.default.join(__dirname, 'foo');
        let newPath = path_1.default.join(__dirname, 'bar');
        await workspace_1.default.createFile(filepath);
        await workspace_1.default.createFile(newPath);
        await workspace_1.default.renameFile(filepath, newPath, { overwrite: true });
        expect(fs_1.default.existsSync(newPath)).toBe(true);
        expect(fs_1.default.existsSync(filepath)).toBe(false);
        fs_1.default.unlinkSync(newPath);
    });
    it('should delete file if exists', async () => {
        let filepath = path_1.default.join(__dirname, 'foo');
        await workspace_1.default.createFile(filepath);
        expect(fs_1.default.existsSync(filepath)).toBe(true);
        await workspace_1.default.deleteFile(filepath);
        expect(fs_1.default.existsSync(filepath)).toBe(false);
    });
    it('should delete folder if exists', async () => {
        let filepath = path_1.default.join(__dirname, 'foo/');
        await workspace_1.default.createFile(filepath);
        expect(fs_1.default.existsSync(filepath)).toBe(true);
        await workspace_1.default.deleteFile(filepath, { recursive: true });
        expect(fs_1.default.existsSync(filepath)).toBe(false);
    });
    it('should open resource', async () => {
        let uri = vscode_uri_1.URI.file(path_1.default.join(__dirname, 'bar')).toString();
        await workspace_1.default.openResource(uri);
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toMatch('bar');
    });
    it('should open none file uri', async () => {
        let uri = 'jdi://abc';
        await workspace_1.default.openResource(uri);
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toBe('jdi://abc');
    });
    it('should open opened buffer', async () => {
        let buf = await helper_1.default.edit();
        let doc = workspace_1.default.getDocument(buf.id);
        await workspace_1.default.openResource(doc.uri);
        await helper_1.default.wait(30);
        let bufnr = await nvim.call('bufnr', '%');
        expect(bufnr).toBe(buf.id);
    });
    it('should open url', async () => {
        await helper_1.default.mockFunction('coc#util#open_url', 0);
        let buf = await helper_1.default.edit();
        let uri = 'http://example.com';
        await workspace_1.default.openResource(uri);
        await helper_1.default.wait(30);
        let bufnr = await nvim.call('bufnr', '%');
        expect(bufnr).toBe(buf.id);
    });
    it('should create database', async () => {
        let db = workspace_1.default.createDatabase('test');
        let res = await db.exists('xyz');
        expect(res).toBe(false);
        await db.destroy();
    });
    it('should create outputChannel', () => {
        let channel = workspace_1.default.createOutputChannel('channel');
        expect(channel.name).toBe('channel');
    });
    it('should show outputChannel', async () => {
        workspace_1.default.createOutputChannel('channel');
        workspace_1.default.showOutputChannel('channel');
        await helper_1.default.wait(100);
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toMatch('channel');
    });
    it('should not show none exists channel', async () => {
        let buf = await nvim.buffer;
        let bufnr = buf.id;
        workspace_1.default.showOutputChannel('NONE');
        await helper_1.default.wait(100);
        buf = await nvim.buffer;
        expect(buf.id).toBe(bufnr);
    });
    it('should get cursor position', async () => {
        await helper_1.default.createDocument();
        await nvim.setLine('测试');
        await nvim.input('A');
        await helper_1.default.wait(30);
        let pos = await workspace_1.default.getCursorPosition();
        expect(pos).toEqual({
            line: 0,
            character: 2
        });
    });
    it('should get current state', async () => {
        let buf = await helper_1.default.edit();
        await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false });
        await nvim.call('cursor', [2, 2]);
        let doc = workspace_1.default.getDocument(buf.id);
        let state = await workspace_1.default.getCurrentState();
        expect(doc.uri).toBe(state.document.uri);
        expect(state.position).toEqual({ line: 1, character: 1 });
    });
    it('should jumpTo position', async () => {
        let uri = vscode_uri_1.URI.file('/tmp/foo').toString();
        await workspace_1.default.jumpTo(uri, { line: 1, character: 1 });
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toMatch('/foo');
        await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false });
        await workspace_1.default.jumpTo(uri, { line: 1, character: 1 });
        let pos = await nvim.call('getcurpos');
        expect(pos.slice(1, 3)).toEqual([2, 2]);
        await nvim.command('bd!');
    });
    it('should jumpTo uri without normalize', async () => {
        let uri = 'zipfile:///tmp/clojure-1.9.0.jar::clojure/core.clj';
        await workspace_1.default.jumpTo(uri);
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toBe(uri);
    });
    it('should jump without position', async () => {
        let uri = vscode_uri_1.URI.file('/tmp/foo').toString();
        await workspace_1.default.jumpTo(uri);
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toMatch('/foo');
    });
    it('should jumpTo custom uri scheme', async () => {
        let uri = 'jdt://foo';
        await workspace_1.default.jumpTo(uri, { line: 1, character: 1 });
        let buf = await nvim.buffer;
        let name = await buf.name;
        expect(name).toBe(uri);
    });
    it('should moveTo position in insert mode', async () => {
        await helper_1.default.edit();
        await nvim.setLine('foo');
        await nvim.input('i');
        await workspace_1.default.moveTo({ line: 0, character: 3 });
        let col = await nvim.call('col', '.');
        expect(col).toBe(4);
        let virtualedit = await nvim.getOption('virtualedit');
        expect(virtualedit).toBe('');
    });
    it('should findUp to tsconfig.json from current file', async () => {
        await helper_1.default.edit(path_1.default.join(__dirname, 'edit'));
        let filepath = await workspace_1.default.findUp('tsconfig.json');
        expect(filepath).toMatch('tsconfig.json');
    });
    it('should findUp from current file ', async () => {
        await helper_1.default.edit('foo');
        let filepath = await workspace_1.default.findUp('tsconfig.json');
        expect(filepath).toMatch('tsconfig.json');
    });
    it('should not findUp from file in other directory', async () => {
        await nvim.command(`edit ${path_1.default.join(os_1.default.tmpdir(), 'foo')}`);
        let filepath = await workspace_1.default.findUp('tsconfig.json');
        expect(filepath).toBeNull();
    });
    it('should resolveRootPath', async () => {
        let file = path_1.default.join(__dirname, 'foo');
        let uri = vscode_uri_1.URI.file(file);
        let res = await workspace_1.default.resolveRootFolder(uri, ['.git']);
        expect(res).toMatch('coc.nvim');
    });
    it('should choose quickpick', async () => {
        let p = workspace_1.default.showQuickpick(['a', 'b']);
        await helper_1.default.wait(100);
        let m = await nvim.mode;
        expect(m.blocking).toBe(true);
        await nvim.input('1<enter>');
        let res = await p;
        expect(res).toBe(0);
        await nvim.input('<enter>');
    });
    it('should cancel quickpick', async () => {
        let p = workspace_1.default.showQuickpick(['a', 'b']);
        await helper_1.default.wait(100);
        let m = await nvim.mode;
        expect(m.blocking).toBe(true);
        await nvim.input('8<enter>');
        let res = await p;
        expect(res).toBe(-1);
        await nvim.input('<enter>');
    });
    it('should show prompt', async () => {
        let p = workspace_1.default.showPrompt('prompt');
        await helper_1.default.wait(100);
        await nvim.input('y');
        let res = await p;
        expect(res).toBe(true);
    });
    it('should request input', async () => {
        let p = workspace_1.default.requestInput('name');
        await helper_1.default.wait(100);
        await nvim.input('bar<enter>');
        let res = await p;
        expect(res).toBe('bar');
    });
    it('should return null when input empty', async () => {
        let p = workspace_1.default.requestInput('name');
        await helper_1.default.wait(100);
        await nvim.input('<enter>');
        let res = await p;
        expect(res).toBeNull();
    });
    it('should regist autocmd', async () => {
        let event;
        let disposable = workspace_1.default.registerAutocmd({
            event: 'TextYankPost',
            arglist: ['v:event'],
            callback: ev => {
                event = ev;
            }
        });
        await nvim.setLine('foo');
        await helper_1.default.wait(30);
        await nvim.command('normal! yy');
        await helper_1.default.wait(30);
        expect(event.regtype).toBe('V');
        expect(event.operator).toBe('y');
        expect(event.regcontents).toEqual(['foo']);
        disposable.dispose();
    });
    it('should regist keymap', async () => {
        let fn = jest.fn();
        await nvim.command('nmap go <Plug>(coc-echo)');
        let disposable = workspace_1.default.registerKeymap(['n', 'v'], 'echo', fn);
        await helper_1.default.wait(30);
        let { mode } = await nvim.mode;
        expect(mode).toBe('n');
        await nvim.call('feedkeys', ['go', 'i']);
        await helper_1.default.wait(100);
        expect(fn).toBeCalledTimes(1);
        disposable.dispose();
        await nvim.call('feedkeys', ['go', 'i']);
        await helper_1.default.wait(100);
        expect(fn).toBeCalledTimes(1);
    });
    it('should regist expr keymap', async () => {
        let called = false;
        let fn = () => {
            called = true;
            return '""';
        };
        await nvim.input('i');
        let { mode } = await nvim.mode;
        expect(mode).toBe('i');
        let disposable = workspace_1.default.registerExprKeymap('i', '"', fn);
        await helper_1.default.wait(30);
        await nvim.call('feedkeys', ['"', 't']);
        await helper_1.default.wait(30);
        expect(called).toBe(true);
        let line = await nvim.line;
        expect(line).toBe('""');
        disposable.dispose();
    });
    it('should regist buffer expr keymap', async () => {
        let fn = () => {
            return '""';
        };
        await nvim.input('i');
        let disposable = workspace_1.default.registerExprKeymap('i', '"', fn, true);
        await helper_1.default.wait(30);
        await nvim.call('feedkeys', ['"', 't']);
        await helper_1.default.wait(30);
        let line = await nvim.line;
        expect(line).toBe('""');
        disposable.dispose();
    });
    it('should watch options', async () => {
        let fn = jest.fn();
        workspace_1.default.watchOption('showmode', fn, disposables);
        await helper_1.default.wait(150);
        await nvim.command('set showmode');
        await helper_1.default.wait(150);
        expect(fn).toBeCalled();
        await nvim.command('noa set noshowmode');
    });
    it('should watch global', async () => {
        let fn = jest.fn();
        workspace_1.default.watchGlobal('x', fn, disposables);
        await nvim.command('let g:x = 1');
        await helper_1.default.wait(30);
    });
});
describe('workspace events', () => {
    it('should listen to fileType change', async () => {
        let buf = await helper_1.default.edit();
        await nvim.command('setf xml');
        await helper_1.default.wait(40);
        let doc = workspace_1.default.getDocument(buf.id);
        expect(doc.filetype).toBe('xml');
    });
    it('should listen optionSet', async () => {
        let opt = workspace_1.default.completeOpt;
        expect(opt).toMatch('menuone');
        await nvim.command('set completeopt=menu,preview');
        await helper_1.default.wait(100);
        opt = workspace_1.default.completeOpt;
        expect(opt).toBe('menu,preview');
    });
    it('should fire onDidOpenTextDocument', async () => {
        let fn = jest.fn();
        workspace_1.default.onDidOpenTextDocument(fn, null, disposables);
        await helper_1.default.edit();
        await helper_1.default.wait(30);
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it('should fire onDidChangeTextDocument', async () => {
        let fn = jest.fn();
        await helper_1.default.edit();
        workspace_1.default.onDidChangeTextDocument(fn, null, disposables);
        await nvim.setLine('foo');
        let doc = await workspace_1.default.document;
        doc.forceSync();
        await helper_1.default.wait(20);
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it('should fire onDidChangeConfiguration', async () => {
        await helper_1.default.createDocument();
        let fn = jest.fn();
        let disposable = workspace_1.default.onDidChangeConfiguration(e => {
            disposable.dispose();
            expect(e.affectsConfiguration('tsserver')).toBe(true);
            expect(e.affectsConfiguration('tslint')).toBe(false);
            fn();
        });
        let config = workspace_1.default.getConfiguration('tsserver');
        config.update('enable', false);
        await helper_1.default.wait(300);
        expect(fn).toHaveBeenCalledTimes(1);
        config.update('enable', undefined);
    });
    it('should get empty configuration for none exists section', () => {
        let config = workspace_1.default.getConfiguration('notexists');
        let keys = Object.keys(config);
        expect(keys.length).toBe(0);
    });
    it('should fire onWillSaveUntil', async () => {
        let doc = await helper_1.default.createDocument();
        let filepath = vscode_uri_1.URI.parse(doc.uri).fsPath;
        let fn = jest.fn();
        let disposable = workspace_1.default.onWillSaveUntil(event => {
            let promise = new Promise(resolve => {
                fn();
                let edit = {
                    newText: 'foo',
                    range: vscode_languageserver_types_1.Range.create(0, 0, 0, 0)
                };
                resolve([edit]);
            });
            event.waitUntil(promise);
        }, null, 'test');
        await helper_1.default.wait(100);
        await nvim.setLine('bar');
        await helper_1.default.wait(30);
        await events_1.default.fire('BufWritePre', [doc.bufnr]);
        await helper_1.default.wait(30);
        let content = doc.getDocumentContent();
        expect(content.startsWith('foobar')).toBe(true);
        disposable.dispose();
        expect(fn).toBeCalledTimes(1);
        if (fs_1.default.existsSync(filepath)) {
            fs_1.default.unlinkSync(filepath);
        }
    });
    it('should attach & detach', async () => {
        let buf = await helper_1.default.edit();
        await nvim.command('CocDisable');
        await helper_1.default.wait(100);
        let doc = workspace_1.default.getDocument(buf.id);
        expect(doc).toBeUndefined();
        await nvim.command('CocEnable');
        await helper_1.default.wait(100);
        doc = workspace_1.default.getDocument(buf.id);
        expect(doc.bufnr).toBe(buf.id);
    });
    it('should create document with same bufnr', async () => {
        await nvim.command('tabe');
        let buf = await helper_1.default.edit();
        await helper_1.default.wait(100);
        let doc = workspace_1.default.getDocument(buf.id);
        expect(doc).toBeDefined();
        await nvim.setLine('foo');
        await helper_1.default.wait(30);
        let content = doc.getDocumentContent();
        expect(content).toMatch('foo');
    });
});
describe('workspace textDocument content provider', () => {
    it('should regist document content provider', async () => {
        let provider = {
            provideTextDocumentContent: (_uri, _token) => {
                return 'sample text';
            }
        };
        workspace_1.default.registerTextDocumentContentProvider('test', provider);
        await helper_1.default.wait(80);
        await nvim.command('edit test://1');
        let buf = await nvim.buffer;
        let lines = await buf.lines;
        expect(lines).toEqual(['sample text']);
    });
    it('should react onChagne event of document content provider', async () => {
        let text = 'foo';
        let emitter = new vscode_languageserver_protocol_1.Emitter();
        let event = emitter.event;
        let provider = {
            onDidChange: event,
            provideTextDocumentContent: (_uri, _token) => {
                return text;
            }
        };
        workspace_1.default.registerTextDocumentContentProvider('jdk', provider);
        await helper_1.default.wait(80);
        await nvim.command('edit jdk://1');
        await helper_1.default.wait(100);
        text = 'bar';
        emitter.fire(vscode_uri_1.URI.parse('jdk://1'));
        await helper_1.default.wait(100);
        let buf = await nvim.buffer;
        let lines = await buf.lines;
        expect(lines).toEqual(['bar']);
    });
});
describe('workspace private', () => {
    it('should init vim events', async () => {
        let buf = await helper_1.default.edit();
        await buf.detach();
        let attached = buf.isAttached;
        expect(attached).toBe(false);
        let doc = workspace_1.default.getDocument(buf.id);
        doc.env.isVim = true;
        workspace_1.default.initVimEvents();
        await nvim.setLine('abc');
        await helper_1.default.wait(300);
        expect(doc.content).toMatch('abc');
        await nvim.input('Adef');
        await nvim.call('coc#_hide');
        await helper_1.default.wait(300);
        expect(doc.getline(0)).toMatch('abcdef');
    });
});
//# sourceMappingURL=workspace.test.js.map