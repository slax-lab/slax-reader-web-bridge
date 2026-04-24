import type { SelectTextInfo, MarkPathItem, SelectionEventData, MarkPathApprox, PositionInfo } from '../types/selection'
import { getElementPath, getRangeTextWithNewlines, getAllTextNodes } from '../utils/selection-utils'

/**
 * 选择监听器
 *
 * 负责监听用户的文本选择操作
 * 仅通过 selectionchange 事件驱动，避免多监听源导致重复触发
 */
export class SelectionMonitor {
  private container: HTMLElement
  private isMonitoring: boolean = false
  private lastSelectionText: string = ''
  private onSelectionCallback?: (data: SelectionEventData) => void
  private onSelectionClearedCallback?: () => void
  private selectionChangeTimeout?: ReturnType<typeof setTimeout>
  /** 用户手指/鼠标是否正在按下 */
  private isPointerDown: boolean = false
  /** 手指按下期间是否产生了待处理的选区变化 */
  private hasPendingSelection: boolean = false

  constructor(container: HTMLElement) {
    this.container = container
  }

  /**
   * 开始监听选择
   * @param callback 选区变化时的回调
   * @param onSelectionCleared 选区取消（collapsed 或清空）时的回调
   */
  start(callback: (data: SelectionEventData) => void, onSelectionCleared?: () => void): void {
    if (this.isMonitoring) {
      return
    }

    this.onSelectionCallback = callback
    this.onSelectionClearedCallback = onSelectionCleared

    document.addEventListener('selectionchange', this.handleSelectionChange)
    document.addEventListener('touchstart', this.handlePointerDown, { passive: true })
    document.addEventListener('mousedown', this.handlePointerDown, { passive: true })
    document.addEventListener('touchend', this.handlePointerUp, { passive: true })
    document.addEventListener('touchcancel', this.handleTouchCancel, { passive: true })
    document.addEventListener('mouseup', this.handlePointerUp, { passive: true })

    this.isMonitoring = true
  }

  /**
   * 停止监听选择
   */
  stop(): void {
    if (!this.isMonitoring) {
      return
    }

    if (this.selectionChangeTimeout) {
      clearTimeout(this.selectionChangeTimeout)
      this.selectionChangeTimeout = undefined
    }

    document.removeEventListener('selectionchange', this.handleSelectionChange)
    document.removeEventListener('touchstart', this.handlePointerDown)
    document.removeEventListener('mousedown', this.handlePointerDown)
    document.removeEventListener('touchend', this.handlePointerUp)
    document.removeEventListener('touchcancel', this.handleTouchCancel)
    document.removeEventListener('mouseup', this.handlePointerUp)

    this.isMonitoring = false
    this.lastSelectionText = ''
    this.isPointerDown = false
    this.hasPendingSelection = false
    this.onSelectionCallback = undefined
    this.onSelectionClearedCallback = undefined
  }

  /**
   * 手指/鼠标按下
   */
  private handlePointerDown = (): void => {
    this.isPointerDown = true
    this.hasPendingSelection = false
  }

  /**
   * 手指/鼠标松开，如果有待处理的选区则立即触发回调
   */
  private handlePointerUp = (): void => {
    this.isPointerDown = false
    if (this.hasPendingSelection) {
      this.hasPendingSelection = false
      this.processSelection()
    }
  }

  /**
   * iOS 长按选择文本时，系统接管触摸会触发 touchcancel 而非 touchend。
   * 此时释放 isPointerDown，让后续 selectionchange 防抖正常触发回调。
   */
  private handleTouchCancel = (): void => {
    this.isPointerDown = false
  }

  /**
   * 处理选择变化事件（带防抖）
   *
   * 手指按下期间仅标记"有待处理"，不触发回调；
   * 手指松开后或非触摸场景（如程序设置选区）才真正通知原生端。
   */
  private handleSelectionChange = (): void => {
    if (this.selectionChangeTimeout) {
      clearTimeout(this.selectionChangeTimeout)
    }

    this.selectionChangeTimeout = setTimeout(() => {
      if (this.isPointerDown) {
        // 手指仍按下，仅标记待处理，不触发回调
        this.hasPendingSelection = true
        return
      }
      this.processSelection()
      this.selectionChangeTimeout = undefined
    }, 300)
  }

  /**
   * 实际处理选区并通知回调
   */
  private processSelection(): void {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      this.clearLastSelection()
      return
    }

    const range = selection.getRangeAt(0)

    if (range.collapsed) {
      this.clearLastSelection()
      return
    }

    if (!this.container.contains(range.commonAncestorContainer)) {
      return
    }

    const currentText = selection.toString()
    if (currentText === this.lastSelectionText) {
      return
    }
    this.lastSelectionText = currentText

    const selectionInfo = this.parseSelectionFromRange(range)
    if (selectionInfo.selection.length === 0) {
      return
    }

    if (this.onSelectionCallback) {
      this.onSelectionCallback(selectionInfo)
    }
  }

  /**
   * 清除上次选区记录并通知外部
   */
  private clearLastSelection(): void {
    if (this.lastSelectionText !== '') {
      this.lastSelectionText = ''
      this.onSelectionClearedCallback?.()
    }
  }

  /**
   * 从 range 解析选择（不需要事件对象）
   */
  private parseSelectionFromRange(range: Range): SelectionEventData {
    const selection = this.getSelectionInfo(range)
    const paths = this.convertSelectionToPaths(selection)
    const approx = this.getApproxInfo(range)
    const position = this.getPositionInfoFromRange(range)

    return { selection, paths, approx, position }
  }

  /**
   * 从 range 获取位置信息
   */
  private getPositionInfoFromRange(range: Range): PositionInfo {
    const rangeRect = range.getBoundingClientRect()
    const containerRect = this.container.getBoundingClientRect()

    const clientX = rangeRect.left + rangeRect.width / 2
    const clientY = rangeRect.bottom

    return {
      x: clientX - containerRect.left,
      y: clientY - containerRect.top,
      width: rangeRect.width,
      height: rangeRect.height,
      top: rangeRect.top - containerRect.top,
      left: rangeRect.left - containerRect.left,
      right: rangeRect.right - containerRect.left,
      bottom: rangeRect.bottom - containerRect.top
    }
  }

  /**
   * 获取选择信息
   */
  private getSelectionInfo(range: Range): SelectTextInfo[] {
    if (!range) {
      return []
    }

    const selectedInfo: SelectTextInfo[] = []

    const isNodeFullyInRange = (node: Node) => {
      const nodeRange = document.createRange()
      nodeRange.selectNodeContents(node)
      return (
        range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
      )
    }

    const isNodePartiallyInRange = (node: Node) => range.intersectsNode(node)

    const processTextNode = (textNode: Text) => {
      if (!isNodePartiallyInRange(textNode)) return

      let startOffset = textNode === range.startContainer ? range.startOffset : 0
      let endOffset = textNode === range.endContainer ? range.endOffset : textNode.length
      startOffset = Math.max(0, Math.min(startOffset, textNode.length))
      endOffset = Math.max(startOffset, Math.min(endOffset, textNode.length))

      if (endOffset > startOffset) {
        selectedInfo.push({
          type: 'text',
          node: textNode,
          startOffset,
          endOffset,
          text: textNode.textContent!.slice(startOffset, endOffset)
        })
      }
    }

    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim() || '').length > 0) {
        processTextNode(node as Text)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement
        if (element.tagName === 'IMG' && isNodeFullyInRange(element)) {
          selectedInfo.push({
            type: 'image',
            src: (element as HTMLImageElement).src,
            element: element as HTMLImageElement
          })
        }
        if (isNodePartiallyInRange(element)) {
          for (const child of Array.from(element.childNodes)) processNode(child)
        }
      }
    }

    processNode(range.commonAncestorContainer)
    return selectedInfo.length > 0 &&
      !selectedInfo.every((item) => item.type === 'text' && item.text.trim().length === 0)
      ? selectedInfo
      : []
  }

  /**
   * 将选择信息转换为路径
   */
  private convertSelectionToPaths(selection: SelectTextInfo[]): MarkPathItem[] {
    const paths: MarkPathItem[] = []
    let currentPath: string | null = null
    let currentStart: number = 0
    let currentEnd: number = 0

    for (const item of selection) {
      if (item.type === 'text') {
        let parent = item.node.parentElement
        while (parent && parent.tagName === 'SLAX-MARK') {
          parent = parent.parentElement
        }

        if (!parent) continue

        const path = getElementPath(parent, this.container)

        // 使用与 mark-renderer 相同的逻辑计算文本节点偏移
        const allTextNodes = getAllTextNodes(parent)
        let offset = 0
        for (const textNode of allTextNodes) {
          if (textNode === item.node) {
            break
          }
          offset += (textNode.textContent || '').length
        }

        const start = offset + item.startOffset
        const end = offset + item.endOffset

        if (path === currentPath) {
          currentEnd = end
        } else {
          if (currentPath !== null) {
            paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd })
          }
          currentPath = path
          currentStart = start
          currentEnd = end
        }
      } else if (item.type === 'image') {
        if (currentPath !== null) {
          paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd })
          currentPath = null
        }

        const path = getElementPath(item.element, this.container)
        paths.push({ type: 'image', path })
      }
    }

    if (currentPath !== null) {
      paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd })
    }

    return paths
  }

  /**
   * 获取近似匹配信息
   */
  private getApproxInfo(range: Range): MarkPathApprox {
    const exact = getRangeTextWithNewlines(range)

    const prefixRange = document.createRange()
    prefixRange.setStart(this.container, 0)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const fullPrefix = getRangeTextWithNewlines(prefixRange)
    const prefix = fullPrefix.slice(-50)

    const suffixRange = document.createRange()
    suffixRange.setStart(range.endContainer, range.endOffset)
    suffixRange.setEndAfter(this.container.lastChild!)
    const fullSuffix = getRangeTextWithNewlines(suffixRange)
    const suffix = fullSuffix.slice(0, 50)

    return { exact, prefix, suffix, raw_text: exact }
  }

  /**
   * 清除选择
   */
  clearSelection(): void {
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
    }
  }
}