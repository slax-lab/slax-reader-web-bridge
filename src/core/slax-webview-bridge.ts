import { postToNativeBridge } from '../bridge/native-bridge';
import { getContentHeight } from '../features/content';
import { initImageClickHandlers } from '../features/images';
import { highlightElement } from '../features/highlight';
import { findMatchingElement } from '../features/search';
import { scrollToAnchor, scrollToElement } from '../features/scroll';
import { initBookmarkNotFoundHandlers } from '../features/bookmark-notfound';
import { applyPolyfills } from '../utils/polyfill';

export class SlaxWebViewBridge {
    constructor() {
        this.init();
    }

    private init() {
        applyPolyfills();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.onDOMReady();
            });
        } else {
            this.onDOMReady();
        }

        console.log('[WebView Bridge] Bridge initialized successfully');
    }

    private onDOMReady() {
        initImageClickHandlers();
        initBookmarkNotFoundHandlers();

        // 通知 native bridge DOM 已加载完成
        postToNativeBridge({
            type: 'domReady'
        });

        console.log('[WebView Bridge] DOM ready event sent to native bridge');
    }

    public postMessage = postToNativeBridge;
    public getContentHeight = getContentHeight;
    public scrollToAnchor = scrollToAnchor;
    public highlightElement = highlightElement;
    public findMatchingElement = findMatchingElement;
    public scrollToElement = scrollToElement;
}
