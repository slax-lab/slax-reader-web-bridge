import { postToNativeBridge } from '../bridge/native-bridge';

/**
 * 初始化书签未找到页面的按钮点击处理程序
 */
export function initBookmarkNotFoundHandlers() {
    const container = document.querySelector('body > .slax-reader-notfound-container > .slax-reader-notfound-btn-container');

    if (!container) {
        console.log('[WebView Bridge] Bookmark not found container not present');
        return;
    }

    // 获取重试按钮和反馈按钮
    const retryBtn = container.querySelector('.retry-btn');
    const feedbackBtn = container.querySelector('.feedback-btn');

    // 为重试按钮添加点击事件
    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            postToNativeBridge({
                type: 'refreshContent'
            });
            console.log('[WebView Bridge] Bookmark retry button clicked');
        });
    }

    // 为反馈按钮添加点击事件
    if (feedbackBtn) {
        feedbackBtn.addEventListener('click', () => {
            postToNativeBridge({
                type: 'feedback'
            });
            console.log('[WebView Bridge] Bookmark feedback button clicked');
        });
    }

    console.log('[WebView Bridge] Initialized bookmark not found handlers');
}
