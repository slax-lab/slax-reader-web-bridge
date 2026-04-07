import { SelectionMonitor } from '../../src/features/selection-monitor';
import type { SelectionEventData } from '../../src/types/selection';

function createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'container';
    document.body.appendChild(container);
    return container;
}

function createTextNode(text: string, parent: HTMLElement): Text {
    const node = document.createTextNode(text)
    parent.appendChild(node)
    return node
}

describe('SelectionMonitor', () => {
    let container: HTMLElement;
    let monitor: SelectionMonitor;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = createContainer();
        monitor = new SelectionMonitor(container);
        jest.useFakeTimers();
    });

    afterEach(() => {
        monitor.stop();
        jest.useRealTimers();
    });

    describe('start / stop', () => {
        test('重复调用 start 不应重复绑定', () => {
            const addSpy = jest.spyOn(document, 'addEventListener');
            const callback = jest.fn();

            monitor.start(callback);
            monitor.start(callback); // 第二次应被忽略

            // selectionchange 只应被绑定一次
            const selectionChangeCalls = addSpy.mock.calls.filter(
                ([event]) => event === 'selectionchange'
            );
            expect(selectionChangeCalls.length).toBe(1);
        });

        test('stop 后不再触发回调', () => {
            const callback = jest.fn();
            monitor.start(callback);
            monitor.stop();

            document.dispatchEvent(new Event('selectionchange'));
            jest.runAllTimers();

            expect(callback).not.toHaveBeenCalled();
        });

        test('未开始监听时调用 stop 不报错', () => {
            expect(() => monitor.stop()).not.toThrow();
        });
    });

    describe('clearSelection', () => {
        test('应清除 window selection', () => {
            const removeAllRanges = jest.fn();
            jest.spyOn(window, 'getSelection').mockReturnValue({
                removeAllRanges,
                rangeCount: 0,
            } as any);

            monitor.clearSelection();

            expect(removeAllRanges).toHaveBeenCalled();
        });
    });

    describe('selectionchange 防抖', () => {
        test('300ms 内多次触发只回调一次', () => {
            const callback = jest.fn();
            monitor.start(callback);

            // 模拟一个有效的 selection
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const range = document.createRange();
            range.setStart(p.firstChild!, 0);
            range.setEnd(p.firstChild!, 5);

            const mockSelection = {
                rangeCount: 1,
                getRangeAt: () => range,
            } as any;
            jest.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

            // 快速触发多次
            document.dispatchEvent(new Event('selectionchange'));
            document.dispatchEvent(new Event('selectionchange'));
            document.dispatchEvent(new Event('selectionchange'));

            // 300ms 前不应触发
            jest.advanceTimersByTime(299);
            expect(callback).not.toHaveBeenCalled();

            // 300ms 后触发一次
            jest.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('collapsed selection 不触发回调', () => {
            const callback = jest.fn();
            monitor.start(callback);

            const p = document.createElement('p');
            p.textContent = 'hello';
            container.appendChild(p);

            const range = document.createRange();
            range.setStart(p.firstChild!, 2);
            range.setEnd(p.firstChild!, 2); // collapsed

            jest.spyOn(window, 'getSelection').mockReturnValue({
                rangeCount: 1,
                getRangeAt: () => range,
            } as any);

            document.dispatchEvent(new Event('selectionchange'));
            jest.runAllTimers();

            expect(callback).not.toHaveBeenCalled();
        });

        test('容器外的 selection 不触发回调', () => {
            const callback = jest.fn();
            monitor.start(callback);

            const outside = document.createElement('p');
            outside.textContent = 'outside text';
            document.body.appendChild(outside);

            const range = document.createRange();
            range.setStart(outside.firstChild!, 0);
            range.setEnd(outside.firstChild!, 7);

            jest.spyOn(window, 'getSelection').mockReturnValue({
                rangeCount: 1,
                getRangeAt: () => range,
            } as any);

            document.dispatchEvent(new Event('selectionchange'));
            jest.runAllTimers();

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('回调数据结构', () => {
        test('应包含 paths、approx、position 字段', () => {
            const callback = jest.fn();
            monitor.start(callback);

            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const range = document.createRange();
            range.setStart(p.firstChild!, 0);
            range.setEnd(p.firstChild!, 5);

            jest.spyOn(window, 'getSelection').mockReturnValue({
                rangeCount: 1,
                getRangeAt: () => range,
                toString: () => 'hello',
                removeAllRanges: jest.fn(),
                addRange: jest.fn(),
            } as any);

            document.dispatchEvent(new Event('selectionchange'));
            jest.runAllTimers();

            expect(callback).toHaveBeenCalledTimes(1);
            const data: SelectionEventData = callback.mock.calls[0][0];
            expect(data).toHaveProperty('selection');
            expect(data).toHaveProperty('paths');
            expect(data).toHaveProperty('approx');
            expect(data).toHaveProperty('position');
            expect(Array.isArray(data.paths)).toBe(true);
        });

        test('selection 中应包含文本内容', () => {
            const callback = jest.fn();
            monitor.start(callback);

            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const range = document.createRange();
            range.setStart(p.firstChild!, 0);
            range.setEnd(p.firstChild!, 5);

            jest.spyOn(window, 'getSelection').mockReturnValue({
                rangeCount: 1,
                getRangeAt: () => range,
                toString: () => 'hello',
                removeAllRanges: jest.fn(),
                addRange: jest.fn(),
            } as any);

            document.dispatchEvent(new Event('selectionchange'));
            jest.runAllTimers();

            const data: SelectionEventData = callback.mock.calls[0][0];
            const textItem = data.selection.find((s) => s.type === 'text');
            expect(textItem).toBeDefined();
            if (textItem?.type === 'text') {
                expect(textItem.text).toBe('hello');
            }
        });
    });
});
