"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const processes_1 = require("../../util/processes");
const child_process_1 = require("child_process");
describe('terminate', () => {
    it('should terminate process', () => {
        let cwd = process.cwd();
        let child = child_process_1.spawn('sleep', ['10'], { cwd, detached: true });
        let res = processes_1.terminate(child, cwd);
        expect(res).toBe(true);
        expect(child.connected).toBe(false);
    });
});
//# sourceMappingURL=processes.test.js.map