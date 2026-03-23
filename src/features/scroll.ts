import { detectPlatform } from '../utils/platform';
import { postToNativeBridge } from '../bridge/native-bridge';
import { findMatchingElement } from './search';
import { highlightElement } from './highlight';

/**
 * 滚动到指定元素
 */
export function scrollToElement(target: { element?: HTMLElement | null, range?: Range | null } | HTMLElement | null) {
    const element = target && 'element' in target ? target.element : target as HTMLElement;
    const range = target && 'range' in target ? target.range : null;

    if (!element) {
        console.warn('[WebView Bridge] Target element does not exist, cannot scroll');
        return;
    }

    const platform = detectPlatform();

    if (platform === 'android') {
        const rect = range ? range.getBoundingClientRect() : element.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const elementTop = rect.top + scrollTop;
        const documentHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
        );

        postToNativeBridge({
            type: 'scrollToPosition',
            percentage: elementTop / documentHeight
        });
    } else if (platform === 'ios') {
        if (range) {
            const rect = range.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const elementTop = rect.top + scrollTop;
            const documentHeight = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
            );

            postToNativeBridge({
                type: 'scrollToPosition',
                percentage: elementTop / documentHeight
            });
        } else {
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        }
    }
}

/**
 * 滚动到锚点文本对应的内容
 */
export function scrollToAnchor(anchorText: string): boolean {
    console.log(`[WebView Bridge] Start finding anchor: ${anchorText}`);

    const decodedAnchor = decodeURIComponent(anchorText);
    const match = findMatchingElement(decodedAnchor);
    if (match) {
        highlightElement(match);
        scrollToElement(match);
        return true;
    } else {
        console.warn(`[WebView Bridge] No matching element found: ${anchorText}`);
        return false;
    }
}
