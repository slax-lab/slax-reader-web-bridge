import { SlaxWebViewBridge } from '../src/core/slax-webview-bridge';
import * as polyfill from '../src/utils/polyfill';
import * as images from '../src/features/images';
import * as bookmarkNotFound from '../src/features/bookmark-notfound';
import * as nativeBridge from '../src/bridge/native-bridge';

describe('SlaxWebViewBridge', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
        jest.spyOn(polyfill, 'applyPolyfills');
        jest.spyOn(images, 'initImageClickHandlers');
        jest.spyOn(bookmarkNotFound, 'initBookmarkNotFoundHandlers');
        jest.spyOn(nativeBridge, 'postToNativeBridge');
    });

    test('应该正确初始化', () => {
        const bridge = new SlaxWebViewBridge();

        expect(polyfill.applyPolyfills).toHaveBeenCalled();
        expect(images.initImageClickHandlers).toHaveBeenCalled();
        expect(bookmarkNotFound.initBookmarkNotFoundHandlers).toHaveBeenCalled();

        expect(bridge.postMessage).toBeDefined();
        expect(bridge.getContentHeight).toBeDefined();
        expect(bridge.scrollToAnchor).toBeDefined();
        expect(bridge.highlightElement).toBeDefined();
    });

    test('应该在 DOM 加载完成后发送 domReady 消息', () => {
        new SlaxWebViewBridge();

        expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
            type: 'domReady'
        });
    });

    test('如果文档正在加载，应该等待 DOMContentLoaded', () => {
        const readyStateSpy = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

        new SlaxWebViewBridge();

        // 不应立即调用
        expect(images.initImageClickHandlers).not.toHaveBeenCalled();
        expect(bookmarkNotFound.initBookmarkNotFoundHandlers).not.toHaveBeenCalled();
        expect(nativeBridge.postToNativeBridge).not.toHaveBeenCalled();

        // 触发 DOMContentLoaded
        document.dispatchEvent(new Event('DOMContentLoaded'));

        expect(images.initImageClickHandlers).toHaveBeenCalled();
        expect(bookmarkNotFound.initBookmarkNotFoundHandlers).toHaveBeenCalled();
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

    describe('drawMark', () => {
        test('未启动监听时应返回 markId 并打印警告', () => {
            const id = bridge.drawMark('test-id', JSON.stringify([{ type: 'text', path: 'p', start: 0, end: 5 }]), true, false);
            expect(id).toBe('test-id');
            expect(console.warn).toHaveBeenCalled();
        });

        test('启动监听后应渲染 mark 并发送 markRendered 消息', () => {
            const container = document.createElement('div');
            container.id = 'content';
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);
            document.body.appendChild(container);

            bridge.startSelectionMonitoring('#content');

            const id = bridge.drawMark(
                'uuid-test',
                JSON.stringify([{ type: 'text', path: 'p', start: 0, end: 5 }]),
                true,
                false
            );

            expect(id).toBe('uuid-test');
            expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'markRendered', markId: 'uuid-test' })
            );
        });

        test('id 为 null 时应自动生成 uuid', () => {
            const container = document.createElement('div');
            container.id = 'content';
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);
            document.body.appendChild(container);

            bridge.startSelectionMonitoring('#content');

            const id = bridge.drawMark(
                null,
                JSON.stringify([{ type: 'text', path: 'p', start: 0, end: 5 }]),
                true,
                false
            );

            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
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

    describe('removeMark / updateMark / clearAllMarks / getAllMarkIds', () => {
        test('未启动监听时调用不报错', () => {
            expect(() => bridge.removeMark('some-id')).not.toThrow();
            expect(() => bridge.updateMark('some-id', true, false)).not.toThrow();
            expect(() => bridge.clearAllMarks()).not.toThrow();
            expect(bridge.getAllMarkIds()).toEqual([]);
        });
    });

    describe('mark 点击事件', () => {
        test('点击 slax-mark 元素应发送 markClicked 消息', () => {
            const container = document.createElement('div');
            container.id = 'content';
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);
            document.body.appendChild(container);

            bridge.startSelectionMonitoring('#content');
            bridge.drawMark(
                'click-uuid',
                JSON.stringify([{ type: 'text', path: 'p', start: 0, end: 5 }]),
                true,
                false
            );

            const mark = container.querySelector('slax-mark[data-uuid="click-uuid"]') as HTMLElement;
            expect(mark).not.toBeNull();

            mark.click();

            expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'markClicked', markId: 'click-uuid' })
            );
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
