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
import type { MarkDetail, MarkItemInfo } from '../types/selection';

export class SlaxWebViewBridge {
    // selection 相关状态
    private selectionMonitor: SelectionMonitor | null = null;
    private markRenderer: MarkRenderer | null = null;
    private markManager: MarkManager | null = null;
    private selectionContainer: HTMLElement | null = null;
    private markClickCleanup: (() => void) | null = null;
    private onMarkTap: ((markId: string, event: TouchEvent) => void) | null = null;
    private onSelectionMarkInfoChange: ((markItemInfo: MarkItemInfo) => void) | null = null;

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
                markItemInfo: markItemInfo ? JSON.stringify(markItemInfo) : null
            });
        };
        this.onMarkTap = onMarkTap;

        /**
         * 选区对应的 MarkItemInfo 变化时，通过 native bridge 通知原生端
         */
        const onSelectionMarkInfoChange = (markItemInfo: MarkItemInfo) => {
            console.log('[WebView Bridge] Selection MarkItemInfo changed:', markItemInfo);
            postToNativeBridge({
                type: 'selectionMarkItemInfo',
                markItemInfo: JSON.stringify(markItemInfo)
            });
        };
        this.onSelectionMarkInfoChange = onSelectionMarkInfoChange;

        this.markRenderer = new MarkRenderer(container, currentUserId, onMarkTap);
        this.markManager = new MarkManager(container, currentUserId, onMarkTap, onSelectionMarkInfoChange);
        this.selectionMonitor = new SelectionMonitor(container);

        this.selectionMonitor.start((data) => {
            // 选区变化时，检测当前选区是否匹配已有的 MarkItemInfo
            this.markManager?.detectSelectionMarkItemInfo(data.paths, data.approx);

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
        }, () => {
            // 选区取消时，清除当前选区对应的 MarkItemInfo（不触发回调）
            this.markManager?.clearCurrentMarkItemInfo();
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
        this.onSelectionMarkInfoChange = null;
    }

    /**
     * 清除当前文本选择
     */
    public clearSelection(): void {
        this.selectionMonitor?.clearSelection();
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
     * 返回 JSON 字符串，结构如下（StrokeCreateData）：
     * ```
     * {
     *   uuid: string              // 本地 UUID，用于 updateMarkIdByUuid 关联后端 mark_id
     *   source: StrokeCreateSource[]        // /v1/mark/create 接口的 source 字段
     *   select_content: StrokeCreateSelectContent[] // 接口的 select_content 字段
     *   approx_source?: StrokeCreateApproxSource    // 接口的 approx_source 字段（含 position_start/position_end）
     * }
     * ```
     *
     * 选区无效时返回 null。
     *
     * @param userId 当前用户ID（可选，用于判断是否为自己的划线样式）
     * @returns StrokeCreateData 的 JSON 字符串，或 null
     */
    public strokeCurrentSelection(userId?: number): string | null {
        if (!this.markManager) {
            console.warn('[WebView Bridge] strokeCurrentSelection: selection monitoring not started');
            return null;
        }
        try {
            const result = this.markManager.strokeCurrentSelection(userId);
            return result ? JSON.stringify(result) : null;
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
     * 根据 UUID 为指定用户添加划线
     *
     * 更新 MarkItemInfo 的 stroke 数组并刷新页面中对应 slax-mark 的样式。
     * 已有该用户划线时幂等跳过。
     *
     * @param uuid MarkItemInfo 的本地 UUID
     * @param userId 执行划线的用户ID
     * @returns 是否成功添加
     */
    public addStrokeByUuid(uuid: string, userId: number): boolean {
        if (!this.markManager) {
            console.warn('[WebView Bridge] addStrokeByUuid: selection monitoring not started');
            return false;
        }
        try {
            return this.markManager.addStrokeByUuid(uuid, userId);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to add stroke by UUID: ${error}` });
            return false;
        }
    }

    /**
     * 通过 source 添加划线（用于临时选区场景）
     *
     * 当 markItemInfo 是临时的（id 为空、未被 markItemInfos 持有）时使用此方法。
     * 会自动创建或复用已有的 MarkItemInfo，插入划线并渲染 DOM。
     *
     * @param sourceJson MarkPathItem[] 的 JSON 字符串
     * @param userId 执行划线的用户ID
     * @param approxJson MarkPathApprox 的 JSON 字符串（可选）
     * @returns StrokeCreateData 的 JSON 字符串（含 uuid 及接口入参），失败返回 null
     */
    public addStrokeBySource(sourceJson: string, userId: number, approxJson?: string): string | null {
        if (!this.markManager) {
            console.warn('[WebView Bridge] addStrokeBySource: selection monitoring not started');
            return null;
        }
        try {
            const source = JSON.parse(sourceJson);
            const approx = approxJson ? JSON.parse(approxJson) : undefined;
            const result = this.markManager.addStrokeBySource(source, userId, approx);
            return result ? JSON.stringify(result) : null;
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to add stroke by source: ${error}` });
            return null;
        }
    }

    /**
     * 根据 UUID 删除指定用户的划线
     *
     * 从 MarkItemInfo 的 stroke 数组中移除该用户的记录并刷新 slax-mark 样式。
     * 若 stroke 和 comments 均为空，则整体删除该标记。
     *
     * @param uuid MarkItemInfo 的本地 UUID
     * @param userId 要删除划线的用户ID
     * @returns 是否成功删除
     */
    public removeStrokeByUuid(uuid: string, userId: number): boolean {
        if (!this.markManager) {
            console.warn('[WebView Bridge] removeStrokeByUuid: selection monitoring not started');
            return false;
        }
        try {
            return this.markManager.removeStrokeByUuid(uuid, userId);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to remove stroke by UUID: ${error}` });
            return false;
        }
    }

    /**
     * 根据 UUID 添加评论
     *
     * 在 MarkItemInfo 的 comments 数组中追加一条评论并刷新 slax-mark 样式（添加 .comment class）。
     *
     * @param uuid MarkItemInfo 的本地 UUID
     * @param params 评论参数对象，包含 userId、comment、username、avatar
     * @returns 是否成功添加
     */
    public addCommentByUuid(uuid: string, params: { userId: number; comment: string; username?: string; avatar?: string }): boolean {
        if (!this.markManager) {
            console.warn('[WebView Bridge] addCommentByUuid: selection monitoring not started');
            return false;
        }
        try {
            return this.markManager.addCommentByUuid(uuid, params);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to add comment by UUID: ${error}` });
            return false;
        }
    }

    /**
     * 通过 UUID 将后端返回的 mark_id 回补到评论记录
     *
     * 在调用 addCommentByUuid 添加本地临时评论后，等后端 API 返回 mark_id，
     * 再调用此方法将临时评论（markId=0）的 markId 更新为真实值。
     *
     * @param uuid MarkItemInfo 的本地 UUID
     * @param markId 后端返回的 mark_id
     * @returns 是否成功更新
     */
    public updateCommentMarkIdByUuid(uuid: string, markId: number): boolean {
        if (!this.markManager) {
            console.warn('[WebView Bridge] updateCommentMarkIdByUuid: selection monitoring not started');
            return false;
        }
        try {
            return this.markManager.updateCommentMarkIdByUuid(uuid, markId);
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to update comment mark id by UUID: ${error}` });
            return false;
        }
    }

    /**
     * 通过 source 添加评论（用于临时选区场景）
     *
     * 当 markItemInfo 是临时的（id 为空、未被 markItemInfos 持有）时使用此方法。
     * 会自动创建或复用已有的 MarkItemInfo，插入评论并渲染 DOM。
     *
     * @param sourceJson MarkPathItem[] 的 JSON 字符串
     * @param commentParams 评论参数对象
     * @param approxJson MarkPathApprox 的 JSON 字符串（可选）
     * @returns StrokeCreateData 的 JSON 字符串（含 uuid 及接口入参），失败返回 null
     */
    public addCommentBySource(
        sourceJson: string,
        commentParams: { userId: number; comment: string; username?: string; avatar?: string },
        approxJson?: string
    ): string | null {
        if (!this.markManager) {
            console.warn('[WebView Bridge] addCommentBySource: selection monitoring not started');
            return null;
        }
        try {
            const source = JSON.parse(sourceJson);
            const approx = approxJson ? JSON.parse(approxJson) : undefined;
            const result = this.markManager.addCommentBySource(source, commentParams, approx);
            return result ? JSON.stringify(result) : null;
        } catch (error) {
            postToNativeBridge({ type: 'selectionError', error: `Failed to add comment by source: ${error}` });
            return null;
        }
    }

    /**
     * 设置当前用户ID（会重建内部 renderer/manager）
     */
    public setCurrentUserId(userId: number): void {
        if (this.selectionContainer) {
            this.markRenderer = new MarkRenderer(this.selectionContainer, userId, this.onMarkTap ?? undefined);
            this.markManager = new MarkManager(this.selectionContainer, userId, this.onMarkTap ?? undefined, this.onSelectionMarkInfoChange ?? undefined);
        }
    }

}
