"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*tslint:disable*/
const assert_1 = tslib_1.__importDefault(require("assert"));
const async_1 = require("../../language-client/utils/async");
test('Delayer', () => {
    let count = 0;
    let factory = () => {
        return Promise.resolve(++count);
    };
    let delayer = new async_1.Delayer(0);
    let promises = [];
    assert_1.default(!delayer.isTriggered());
    promises.push(delayer.trigger(factory).then((result) => { assert_1.default.equal(result, 1); assert_1.default(!delayer.isTriggered()); }));
    assert_1.default(delayer.isTriggered());
    promises.push(delayer.trigger(factory).then((result) => { assert_1.default.equal(result, 1); assert_1.default(!delayer.isTriggered()); }));
    assert_1.default(delayer.isTriggered());
    promises.push(delayer.trigger(factory).then((result) => { assert_1.default.equal(result, 1); assert_1.default(!delayer.isTriggered()); }));
    assert_1.default(delayer.isTriggered());
    return Promise.all(promises).then(() => {
        assert_1.default(!delayer.isTriggered());
    });
});
test('Delayer - simple cancel', async () => {
    let count = 0;
    let factory = () => {
        return Promise.resolve(++count);
    };
    let delayer = new async_1.Delayer(10);
    assert_1.default(!delayer.isTriggered());
    const p = delayer.trigger(factory).then(() => {
        assert_1.default(false);
    }, () => {
        assert_1.default(true, 'yes, it was cancelled');
    });
    assert_1.default(delayer.isTriggered());
    delayer.cancel();
    assert_1.default(!delayer.isTriggered());
    await p;
});
test('Delayer - cancel should cancel all calls to trigger', function () {
    let count = 0;
    let factory = () => {
        return Promise.resolve(++count);
    };
    let delayer = new async_1.Delayer(0);
    let promises = [];
    assert_1.default(!delayer.isTriggered());
    promises.push(delayer.trigger(factory).then(null, () => { assert_1.default(true, 'yes, it was cancelled'); }));
    assert_1.default(delayer.isTriggered());
    promises.push(delayer.trigger(factory).then(null, () => { assert_1.default(true, 'yes, it was cancelled'); }));
    assert_1.default(delayer.isTriggered());
    promises.push(delayer.trigger(factory).then(null, () => { assert_1.default(true, 'yes, it was cancelled'); }));
    assert_1.default(delayer.isTriggered());
    delayer.cancel();
    return Promise.all(promises).then(() => {
        assert_1.default(!delayer.isTriggered());
    });
});
test('Delayer - trigger, cancel, then trigger again', function () {
    let count = 0;
    let factory = () => {
        return Promise.resolve(++count);
    };
    let delayer = new async_1.Delayer(0);
    let promises = [];
    assert_1.default(!delayer.isTriggered());
    const p = delayer.trigger(factory).then((result) => {
        assert_1.default.equal(result, 1);
        assert_1.default(!delayer.isTriggered());
        promises.push(delayer.trigger(factory).then(null, () => { assert_1.default(true, 'yes, it was cancelled'); }));
        assert_1.default(delayer.isTriggered());
        promises.push(delayer.trigger(factory).then(null, () => { assert_1.default(true, 'yes, it was cancelled'); }));
        assert_1.default(delayer.isTriggered());
        delayer.cancel();
        const p = Promise.all(promises).then(() => {
            promises = [];
            assert_1.default(!delayer.isTriggered());
            promises.push(delayer.trigger(factory).then(() => { assert_1.default.equal(result, 1); assert_1.default(!delayer.isTriggered()); }));
            assert_1.default(delayer.isTriggered());
            promises.push(delayer.trigger(factory).then(() => { assert_1.default.equal(result, 1); assert_1.default(!delayer.isTriggered()); }));
            assert_1.default(delayer.isTriggered());
            const p = Promise.all(promises).then(() => {
                assert_1.default(!delayer.isTriggered());
            });
            assert_1.default(delayer.isTriggered());
            return p;
        });
        return p;
    });
    assert_1.default(delayer.isTriggered());
    return p;
});
test('Delayer - last task should be the one getting called', function () {
    let factoryFactory = (n) => () => {
        return Promise.resolve(n);
    };
    let delayer = new async_1.Delayer(0);
    let promises = [];
    assert_1.default(!delayer.isTriggered());
    promises.push(delayer.trigger(factoryFactory(1)).then((n) => { assert_1.default.equal(n, 3); }));
    promises.push(delayer.trigger(factoryFactory(2)).then((n) => { assert_1.default.equal(n, 3); }));
    promises.push(delayer.trigger(factoryFactory(3)).then((n) => { assert_1.default.equal(n, 3); }));
    const p = Promise.all(promises).then(() => {
        assert_1.default(!delayer.isTriggered());
    });
    assert_1.default(delayer.isTriggered());
    return p;
});
//# sourceMappingURL=delayer.test.js.map