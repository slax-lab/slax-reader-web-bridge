import { postToNativeBridge } from '../bridge/native-bridge';
import { getContentHeight } from '../features/content';
import { initImageClickHandlers } from '../features/images';
import { highlightElement } from '../features/highlight';
import { findMatchingElement } from '../features/search';
import { scrollToAnchor, scrollToElement } from '../features/scroll';
import { initBookmarkNotFoundHandlers } from '../features/bookmark-notfound';
import { applyPolyfills } from '../utils/polyfill';
import { SelectionMonitor } from '../features/selection-monitor';
import { MarkRenderer } from '../features/mark-renderer';
import { MarkManager } from '../features/mark-manager';
import { generateUUID } from '../utils/selection-utils';
import type { MarkPathItem, MarkDetail, PositionInfo } from '../types/selection';

export class SlaxWebViewBridge {
    // selection 相关状态
    private selectionMonitor: SelectionMonitor | null = null;
    private markRenderer: MarkRenderer | null = null;
    private markManager: MarkManager | null = null;
    private selectionContainer: HTMLElement | null = null;
    private markClickCleanup: (() => void) | null = null;

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
        this.markRenderer = new MarkRenderer(container, currentUserId);
        this.markManager = new MarkManager(container, currentUserId);
        this.selectionMonitor = new SelectionMonitor(container);

        this.setupMarkClickListener(container);

        this.selectionMonitor.start((data) => {
            const jsonData = JSON.stringify({
                paths: data.paths,
                approx: data.approx,
                selection: data.selection.map((item) => {
                    if (item.type === 'text') {
                        return {
                            type: 'text',
                            text: item.text,
                            start_offset: item.startOffset,
                            end_offset: item.endOffset
                        };
                    } else {
                        return { type: 'image', src: item.src };
                    }
                })
            });

            postToNativeBridge({
                type: 'textSelected',
                data: jsonData,
                position: JSON.stringify(data.position)
            });
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
        this.markRenderer = null;
        this.markManager = null;
    }

    /**
     * 清除当前文本选择
     */
    public clearSelection(): void {
        this.selectionMonitor?.clearSelection();
    }

    /**
     * 绘制标记
     * @param id 标记ID（传 null 则自动生成）
     * @param pathsJson MarkPathItem[] 的 JSON 字符串
     * @param isStroke 是否为划线
     * @param hasComment 是否有评论
     * @param userId 用户ID（可选）
     * @returns 标记ID
     */
    public drawMark(
        id: string | null,
        pathsJson: string,
        isStroke: boolean,
        hasComment: boolean,
        userId?: number
    ): string {
        const markId = id || generateUUID();
        if (!this.markRenderer) {
            console.warn('[WebView Bridge] drawMark: selection monitoring not started');
            return markId;
        }
        try {
            const paths: MarkPathItem[] = JSON.parse(pathsJson);
            const success = this.markRenderer.drawMark(markId, paths, isStroke, hasComment, userId);
            postToNativeBridge({ type: 'markRendered', markId, success });
            return markId;
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to draw mark: ${error}` });
            return markId;
        }
    }

    /**
     * 更新标记
     */
    public updateMark(id: string, isStroke: boolean, hasComment: boolean, userId?: number): void {
        if (!this.markRenderer) return;
        try {
            this.markRenderer.updateMark(id, isStroke, hasComment, userId);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to update mark: ${error}` });
        }
    }

    /**
     * 删除标记
     */
    public removeMark(id: string): void {
        if (!this.markRenderer) return;
        try {
            this.markRenderer.removeMark(id);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to remove mark: ${error}` });
        }
    }

    /**
     * 高亮标记
     */
    public highlightMark(id: string): void {
        if (!this.markRenderer) return;
        try {
            this.markRenderer.highlightMark(id);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to highlight mark: ${error}` });
        }
    }

    /**
     * 清除所有高亮
     */
    public clearHighlights(): void {
        this.markRenderer?.clearAllHighlights();
    }

    /**
     * 清除所有标记
     */
    public clearAllMarks(): void {
        this.markRenderer?.clearAllMarks();
        this.markManager?.clearAllMarks();
    }

    /**
     * 获取所有标记ID
     */
    public getAllMarkIds(): string[] {
        return this.markRenderer?.getAllMarkIds() ?? [];
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
     * 根据 UUID 删除标记
     */
    public removeMarkByUuid(uuid: string): void {
        if (!this.markManager) return;
        try {
            this.markManager.removeMarkByUuid(uuid);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to remove mark by UUID: ${error}` });
        }
    }

    /**
     * 对当前选中区域执行划线处理（不调用后端 API，仅本地渲染）
     *
     * 读取 window.getSelection() → 解析路径和 approx → 构建 MarkItemInfo → 渲染划线标记
     *
     * 后续拿到后端 mark_id 后，可调用 updateMarkIdByUuid 将其与返回的 uuid 关联。
     *
     * @param userId 当前用户ID（可选，用于判断是否为自己的划线样式）
     * @returns 新建标记的 uuid，若选区无效则返回 null
     */
    public strokeCurrentSelection(userId?: number): string | null {
        if (!this.markManager) {
            console.warn('[WebView Bridge] strokeCurrentSelection: selection monitoring not started');
            return null;
        }
        try {
            return this.markManager.strokeCurrentSelection(userId);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to stroke selection: ${error}` });
            return null;
        }
    }

    /**
     * 通过 uuid 将后端返回的 mark_id 关联到本地 MarkItemInfo 的 stroke 记录
     *
     * 在调用 strokeCurrentSelection 拿到 uuid 后，等后端 API 返回 mark_id，
     * 再调用此方法完成关联，以便后续删除/更新操作能找到正确的后端 ID。
     *
     * @param uuid strokeCurrentSelection 返回的 uuid
     * @param markId 后端返回的 mark_id
     * @param userId 用户ID（可选，用于精确匹配对应 stroke 条目）
     */
    public updateMarkIdByUuid(uuid: string, markId: number, userId?: number): void {
        if (!this.markManager) return;
        try {
            this.markManager.updateMarkIdByUuid(uuid, markId, userId);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to update mark id by UUID: ${error}` });
        }
    }

    /**
     * 设置当前用户ID（会重建内部 renderer/manager）
     */
    public setCurrentUserId(userId: number): void {
        if (this.selectionContainer) {
            this.markRenderer = new MarkRenderer(this.selectionContainer, userId);
            this.markManager = new MarkManager(this.selectionContainer, userId);
        }
    }

    /**
     * 设置 mark 点击事件监听
     */
    private setupMarkClickListener(container: HTMLElement): void {
        const handler = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            let markElement: HTMLElement | null = target;

            while (markElement && markElement !== container) {
                if (markElement.tagName === 'SLAX-MARK' && markElement.dataset.uuid) {
                    const markId = markElement.dataset.uuid;

                    const markData = JSON.stringify({
                        id: markId,
                        text: markElement.textContent || '',
                        classList: Array.from(markElement.classList)
                    });

                    const containerRect = container.getBoundingClientRect();
                    const markRect = markElement.getBoundingClientRect();
                    const position: PositionInfo = {
                        x: event.clientX - containerRect.left,
                        y: event.clientY - containerRect.top,
                        width: markRect.width,
                        height: markRect.height,
                        top: markRect.top - containerRect.top,
                        left: markRect.left - containerRect.left,
                        right: markRect.right - containerRect.left,
                        bottom: markRect.bottom - containerRect.top
                    };

                    postToNativeBridge({
                        type: 'markClicked',
                        markId,
                        data: markData,
                        position: JSON.stringify(position)
                    });

                    event.stopPropagation();
                    break;
                }
                markElement = markElement.parentElement;
            }
        };

        container.addEventListener('click', handler);
        this.markClickCleanup = () => container.removeEventListener('click', handler);
    }
}
