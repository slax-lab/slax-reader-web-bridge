import { SlaxWebViewBridge } from '../src/core/slax-webview-bridge';
import * as polyfill from '../src/utils/polyfill';
import * as images from '../src/features/images';
import * as bookmarkNotFound from '../src/features/bookmark-notfound';
import * as nativeBridge from '../src/bridge/native-bridge';

describe('SlaxWebViewBridge', () => {
    beforeEach(() => {
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
