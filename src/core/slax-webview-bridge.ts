import { postToNativeBridge } from '../bridge/native-bridge';
import { getContentHeight } from '../features/content';
import { initImageClickHandlers } from '../features/images';
import { highlightElement } from '../features/highlight';
import { findMatchingElement } from '../features/search';
import { scrollToAnchor, scrollToElement } from '../features/scroll';
import { initBookmarkNotFoundHandlers } from '../features/bookmark-notfound';
import { applyPolyfills } from '../utils/polyfill';
import { SelectionMonitor } from '../features/selection-monitor';
import { MarkManager } from '../features/mark-manager';
import type { MarkDetail, MarkItemInfo } from '../types/selection';

export class SlaxWebViewBridge {
    // selection 相关状态
    private selectionMonitor: SelectionMonitor | null = null;
    private markManager: MarkManager | null = null;
    private selectionContainer: HTMLElement | null = null;
    private markClickCleanup: (() => void) | null = null;
    private onMarkTap: ((markId: string, event: TouchEvent) => void) | null = null;
    private onMarkItemInfosChange: ((markItemInfos: MarkItemInfo[]) => void) | null = null;

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

    // ==================== 划线选择功能 ====================

    /**
     * 开始监听文本选择
     * @param containerSelector 监听容器的 CSS 选择器
     * @param currentUserId 当前用户ID（可选，用于判断是否为自己的划线）
     */
    public startSelectionMonitoring(containerSelector: string, currentUserId?: number): void {
        const container = document.querySelector(containerSelector) as HTMLElement;
        if (!container) {
            console.error(`[WebView Bridge] Container not found: ${containerSelector}`);
            return;
        }

        // 如果已有监听器，先停止
        this.stopSelectionMonitoring();

        this.selectionContainer = container;

        // 追踪 touchstart 位置，供每个 slax-mark 的 touchend 回调做滚动判断
        let touchStartX = 0;
        let touchStartY = 0;
        const trackTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }
        };
        document.addEventListener('touchstart', trackTouchStart, { passive: true });
        this.markClickCleanup = () => document.removeEventListener('touchstart', trackTouchStart);

        /**
         * 每个 slax-mark 元素绑定此回调（在 MarkRenderer 内直接 addEventListener）。
         * 在元素自身的 touchend 中判断：选区是否为空、手指是否移动过大，
         * 再聚合同 UUID 所有 mark 的文本发送给 native。
         */
        const onMarkTap = (markId: string, event: TouchEvent) => {
            if (event.changedTouches.length === 0) return;

            // 有文本选中说明用户在选词，不触发划线点击
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;

            const touch = event.changedTouches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
            // 移动超过 10px 视为滚动
            if (dx > 10 || dy > 10) return;

            const allMarks = Array.from(
                container.querySelectorAll(`slax-mark[data-uuid="${markId}"]`)
            );
            const fullText = allMarks.map((el) => el.textContent || '').join('');
            const markItemInfo = this.markManager?.getMarkItemInfoByUuid(markId) ?? null;

            postToNativeBridge({
                type: 'markClicked',
                markId,
                text: fullText,
                data: markItemInfo ? JSON.stringify(markItemInfo) : null
            });
        };
        this.onMarkTap = onMarkTap;

        /**
         * markItemInfos 数据变化时，通过 native bridge 通知原生端
         */
        const onMarkItemInfosChange = (markItemInfos: MarkItemInfo[]) => {
            console.log('[WebView Bridge] MarkItemInfos changed, count:', markItemInfos.length);
            postToNativeBridge({
                type: 'markItemInfosChanged',
                markItemInfos: JSON.stringify(markItemInfos)
            });
        };
        this.onMarkItemInfosChange = onMarkItemInfosChange;

        this.markManager = new MarkManager(container, currentUserId, onMarkTap, onMarkItemInfosChange);
        this.selectionMonitor = new SelectionMonitor(container);

        this.selectionMonitor.start((data) => {
            const markItemInfo = this.markManager?.resolveMarkItemInfo(data.paths, data.approx) ?? null;
            postToNativeBridge({
                type: 'textSelected',
                data: markItemInfo ? JSON.stringify(markItemInfo) : null,
            });
        }, () => {
            postToNativeBridge({ type: 'textDeselected' });
        });

        console.log(`[WebView Bridge] Selection monitoring started on: ${containerSelector}`);
    }

    /**
     * 停止监听文本选择
     */
    public stopSelectionMonitoring(): void {
        if (this.selectionMonitor) {
            this.selectionMonitor.stop();
            this.selectionMonitor = null;
        }
        if (this.markClickCleanup) {
            this.markClickCleanup();
            this.markClickCleanup = null;
        }
        this.selectionContainer = null;
        this.markManager = null;
        this.onMarkItemInfosChange = null;
    }

    /**
     * 清除当前文本选择
     */
    public clearSelection(): void {
        this.selectionMonitor?.clearSelection();
    }


    /**
     * 批量绘制标记（从后端 MarkDetail 数据）
     * @param markDetailJson MarkDetail 的 JSON 字符串
     * @returns DrawMarksResult 的 JSON 字符串：{ uuid: BackendMarkInfo[] }
     */
    public drawMarks(markDetailJson: string): string {
        if (!this.markManager) {
            console.warn('[WebView Bridge] drawMarks: selection monitoring not started');
            return JSON.stringify({});
        }
        try {
            const markDetail: MarkDetail = JSON.parse(markDetailJson);
            const result = this.markManager.drawMarks(markDetail);
            return JSON.stringify(result);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to draw marks: ${error}` });
            return JSON.stringify({});
        }
    }

    /**
     * 获取当前选区数据（不执行划线渲染）
     *
     * 仅读取当前选区并返回接口所需的数据结构，不进行本地渲染和幂等处理。
     *
     * @returns 选区数据的 JSON 字符串，或 null
     */
    public captureCurrentSelection(): string | null {
        if (!this.markManager) {
            console.warn('[WebView Bridge] captureCurrentSelection: selection monitoring not started');
            return null;
        }
        try {
            const result = this.markManager.captureCurrentSelection();
            return result ? JSON.stringify(result) : null;
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to capture selection: ${error}` });
            return null;
        }
    }


    /**
     * 设置当前用户ID（会重建内部 renderer/manager）
     */
    public setCurrentUserId(userId: number): void {
        if (this.selectionContainer) {
            this.markManager = new MarkManager(this.selectionContainer, userId, this.onMarkTap ?? undefined, this.onMarkItemInfosChange ?? undefined);
        }
    }

}
