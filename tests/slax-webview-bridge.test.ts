import { SlaxWebViewBridge } from '../src/core/slax-webview-bridge';
import * as polyfill from '../src/utils/polyfill';
import * as nativeBridge from '../src/bridge/native-bridge';
import * as search from '../src/features/search';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('SlaxWebViewBridge', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
        jest.spyOn(polyfill, 'applyPolyfills');
        jest.spyOn(nativeBridge, 'postToNativeBridge');
    });

    test('应该正确初始化', () => {
        const bridge = new SlaxWebViewBridge();

        expect(polyfill.applyPolyfills).toHaveBeenCalled();

        expect(bridge.postMessage).toBeDefined();
        expect(bridge.getContentHeight).toBeDefined();
        expect(bridge.scrollToAnchor).toBeDefined();
        expect(bridge.highlightElement).toBeDefined();
    });

    test('应该在 DOM 加载完成后发送 domReady 消息', async () => {
        new SlaxWebViewBridge();

        await flushPromises();

        expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
            type: 'domReady'
        });
    });

    test('如果文档正在加载，应该等待 DOMContentLoaded', async () => {
        const readyStateSpy = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

        new SlaxWebViewBridge();

        expect(nativeBridge.postToNativeBridge).not.toHaveBeenCalled();

        document.dispatchEvent(new Event('DOMContentLoaded'));

        await flushPromises();

        expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
            type: 'domReady'
        });

        readyStateSpy.mockRestore();
    });
});

describe('SlaxWebViewBridge - 划线选择功能', () => {
    let bridge: SlaxWebViewBridge;

    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
        jest.spyOn(nativeBridge, 'postToNativeBridge');
        bridge = new SlaxWebViewBridge();
    });

    afterEach(() => {
        bridge.stopSelectionMonitoring();
    });

    describe('startSelectionMonitoring', () => {
        test('容器不存在时应打印错误并不报错', () => {
            expect(() => bridge.startSelectionMonitoring('#nonexistent')).not.toThrow();
            expect(console.error).toHaveBeenCalled();
        });

        test('应成功启动监听', () => {
            const container = document.createElement('div');
            container.id = 'content';
            document.body.appendChild(container);

            expect(() => bridge.startSelectionMonitoring('#content')).not.toThrow();
        });

        test('重复调用应先停止旧监听再启动新监听', () => {
            const container = document.createElement('div');
            container.id = 'content';
            document.body.appendChild(container);

            bridge.startSelectionMonitoring('#content');
            expect(() => bridge.startSelectionMonitoring('#content')).not.toThrow();
        });
    });

    describe('stopSelectionMonitoring', () => {
        test('未启动时调用不报错', () => {
            expect(() => bridge.stopSelectionMonitoring()).not.toThrow();
        });
    });

    describe('scrollToAnchor', () => {
        test('应结束旧用户选区、抑制锚点选区，并恢复后续用户选择', () => {
            jest.useFakeTimers();
            try {
                const container = document.createElement('div');
                container.id = 'content';
                const p = document.createElement('p');
                p.textContent = 'old selection anchor next selection';
                container.appendChild(p);
                document.body.appendChild(container);
                bridge.startSelectionMonitoring('#content');

                const textNode = p.firstChild!;
                const selection = window.getSelection()!;
                const oldRange = document.createRange();
                oldRange.setStart(textNode, 0);
                oldRange.setEnd(textNode, 13);
                oldRange.getBoundingClientRect = jest.fn().mockReturnValue({
                    left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0
                });
                selection.removeAllRanges();
                selection.addRange(oldRange);
                document.dispatchEvent(new Event('selectionchange'));
                jest.advanceTimersByTime(300);

                const postSpy = nativeBridge.postToNativeBridge as jest.MockedFunction<typeof nativeBridge.postToNativeBridge>;
                const selectedMessages = () => postSpy.mock.calls
                    .map(([message]) => message)
                    .filter(message => message.type === 'textSelected');
                const deselectedMessages = () => postSpy.mock.calls
                    .map(([message]) => message)
                    .filter(message => message.type === 'textDeselected');
                expect(selectedMessages()).toHaveLength(1);

                const anchorRange = document.createRange();
                anchorRange.setStart(textNode, 14);
                anchorRange.setEnd(textNode, 20);
                anchorRange.getBoundingClientRect = jest.fn().mockReturnValue({
                    left: 100, top: 0, right: 150, bottom: 20, width: 50, height: 20, x: 100, y: 0
                });
                jest.spyOn(search, 'findMatchingElement').mockReturnValue({ element: p, range: anchorRange });

                expect(bridge.scrollToAnchor('anchor')).toBe(true);
                expect(deselectedMessages()).toHaveLength(1);
                document.dispatchEvent(new Event('selectionchange'));
                jest.advanceTimersByTime(300);
                expect(selectedMessages()).toHaveLength(1);

                const nextRange = document.createRange();
                nextRange.setStart(textNode, 21);
                nextRange.setEnd(textNode, 25);
                nextRange.getBoundingClientRect = jest.fn().mockReturnValue({
                    left: 160, top: 0, right: 200, bottom: 20, width: 40, height: 20, x: 160, y: 0
                });
                document.dispatchEvent(new MouseEvent('mousedown'));
                selection.removeAllRanges();
                selection.addRange(nextRange);
                document.dispatchEvent(new Event('selectionchange'));
                jest.advanceTimersByTime(300);
                document.dispatchEvent(new MouseEvent('mouseup'));

                expect(selectedMessages()).toHaveLength(2);
                expect(deselectedMessages()).toHaveLength(1);
            } finally {
                jest.useRealTimers();
            }
        });

        test('找不到锚点时应保留旧用户选区状态', () => {
            const container = document.createElement('div');
            container.id = 'content';
            document.body.appendChild(container);
            bridge.startSelectionMonitoring('#content');
            const prepareSpy = jest.spyOn(
                (bridge as unknown as { selectionMonitor: { prepareForProgrammaticSelection: () => void } }).selectionMonitor,
                'prepareForProgrammaticSelection'
            );
            jest.spyOn(search, 'findMatchingElement').mockReturnValue(null);

            expect(bridge.scrollToAnchor('missing')).toBe(false);
            expect(prepareSpy).not.toHaveBeenCalled();
        });
    });

    describe('drawMarks', () => {
        test('未启动监听时应返回空 JSON 对象', () => {
            const result = bridge.drawMarks(JSON.stringify({ mark_list: [], user_list: {} }));
            expect(JSON.parse(result)).toEqual({});
        });

        test('启动监听后应处理 MarkDetail 并返回 uuid 映射', () => {
            const container = document.createElement('div');
            container.id = 'content';
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);
            document.body.appendChild(container);

            bridge.startSelectionMonitoring('#content');

            const markDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 101,
                        user_id: 1,
                        type: 1,
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 0,
                        comment: '',
                        created_at: new Date().toISOString(),
                        is_deleted: false,
                    },
                ],
            };

            const result = JSON.parse(bridge.drawMarks(JSON.stringify(markDetail)));
            const uuids = Object.keys(result);
            expect(uuids.length).toBe(1);
        });
    });

    describe('setCurrentUserId', () => {
        test('未启动监听时调用不报错', () => {
            expect(() => bridge.setCurrentUserId(42)).not.toThrow();
        });

        test('启动监听后调用应重建 renderer/manager', () => {
            const container = document.createElement('div');
            container.id = 'content';
            document.body.appendChild(container);

            bridge.startSelectionMonitoring('#content', 1);
            expect(() => bridge.setCurrentUserId(2)).not.toThrow();
        });
    });
});
