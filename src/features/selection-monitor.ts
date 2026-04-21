import type { SelectTextInfo, MarkPathItem, SelectionEventData, MarkPathApprox, PositionInfo } from '../types/selection'
import { getElementPath, getRangeTextWithNewlines, getAllTextNodes } from '../utils/selection-utils'

/**
 * 选择监听器
 *
 * 负责监听用户的文本选择操作
 */
export class SelectionMonitor {
  private container: HTMLElement
  private isMonitoring: boolean = false
  private onSelectionCallback?: (data: SelectionEventData) => void
  private selectionChangeTimeout?: ReturnType<typeof setTimeout>

  constructor(container: HTMLElement) {
    this.container = container
  }

  /**
   * 开始监听选择
   */
  start(callback: (data: SelectionEventData) => void): void {
    if (this.isMonitoring) {
      return
    }

    this.onSelectionCallback = callback

    // 使用 selectionchange 事件（更适合 Android WebView）
    document.addEventListener('selectionchange', this.handleSelectionChange)

    // 保留 mouseup 和 touchend 作为备用（兼容性）
    this.container.addEventListener('mouseup', this.handleMouseUp)
    this.container.addEventListener('touchend', this.handleMouseUp)

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
    this.container.removeEventListener('mouseup', this.handleMouseUp)
    this.container.removeEventListener('touchend', this.handleMouseUp)

    this.isMonitoring = false
    this.onSelectionCallback = undefined
  }

  /**
   * 处理选择变化事件（带防抖）
   */
  private handleSelectionChange = (): void => {
    if (this.selectionChangeTimeout) {
      clearTimeout(this.selectionChangeTimeout)
    }

    this.selectionChangeTimeout = setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        return
      }

      const range = selection.getRangeAt(0)

      if (range.collapsed) {
        return
      }

      if (!this.container.contains(range.commonAncestorContainer)) {
        return
      }

      const selectionInfo = this.parseSelectionFromRange(range)
      if (selectionInfo.selection.length === 0) {
        return
      }

      if (this.onSelectionCallback) {
        this.onSelectionCallback(selectionInfo)
      }

      this.selectionChangeTimeout = undefined
    }, 300)
  }

  /**
   * 处理鼠标抬起事件（备用方案）
   */
  private handleMouseUp = (event: MouseEvent | TouchEvent): void => {
    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        return
      }

      const range = selection.getRangeAt(0)
      if (range.collapsed) {
        return
      }

      const selectionInfo = this.parseSelection(range, event)
      if (selectionInfo.selection.length === 0) {
        return
      }

      if (this.onSelectionCallback) {
        this.onSelectionCallback(selectionInfo)
      }
    }, 10)
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
   * 解析选择的内容（带事件对象）
   */
  private parseSelection(range: Range, event: MouseEvent | TouchEvent): SelectionEventData {
    const selection = this.getSelectionInfo(range)
    const paths = this.convertSelectionToPaths(selection)
    const approx = this.getApproxInfo(range)
    const position = this.getPositionInfo(range, event)

    return { selection, paths, approx, position }
  }

  /**
   * 从 range 获取位置信息（不需要事件对象）
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
   * 获取位置信息（用于显示菜单）
   */
  private getPositionInfo(range: Range, event: MouseEvent | TouchEvent): PositionInfo {
    const rangeRect = range.getBoundingClientRect()
    const containerRect = this.container.getBoundingClientRect()

    let clientX: number
    let clientY: number

    if (event instanceof MouseEvent) {
      clientX = event.clientX
      clientY = event.clientY
    } else {
      clientX = event.changedTouches[0].clientX
      clientY = event.changedTouches[0].clientY
    }

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
