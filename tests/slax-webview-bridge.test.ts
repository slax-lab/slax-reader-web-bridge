import { SlaxWebViewBridge } from '../src/core/slax-webview-bridge';
import * as polyfill from '../src/utils/polyfill';
import * as nativeBridge from '../src/bridge/native-bridge';

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
