import type { DrawMarkInfo, MarkPathItem } from '../types/selection'
import { removeOuterTag, getAllTextNodes } from '../utils/selection-utils'

/**
 * 标记渲染器
 *
 * 负责在页面上绘制、更新和删除标记（划线和评论）
 */
export class MarkRenderer {
  private container: HTMLElement
  private currentUserId?: number
  private onMarkTap?: (markId: string, event: TouchEvent) => void

  constructor(
    container: HTMLElement,
    currentUserId?: number,
    onMarkTap?: (markId: string, event: TouchEvent) => void
  ) {
    this.container = container
    this.currentUserId = currentUserId
    this.onMarkTap = onMarkTap
  }

  /**
   * 根据 MarkPathItem 绘制标记
   */
  drawMark(
    id: string,
    paths: MarkPathItem[],
    isStroke: boolean,
    hasComment: boolean,
    userId?: number
  ): boolean {
    try {
      const isSelfStroke = userId !== undefined && userId === this.currentUserId

      const baseInfo: DrawMarkInfo = {
        id,
        isStroke,
        hasComment,
        isSelfStroke,
        isHighlighted: false
      }

      let drawMarkSuccess = false

      for (const markItem of paths) {
        if (!isStroke && !hasComment) continue

        const infos = this.transferNodeInfos(markItem)
        for (const infoItem of infos) {
          if (infoItem.type === 'image') {
            this.addImageMark({ ...baseInfo, ele: infoItem.ele as HTMLImageElement })
            continue
          }
          this.addMark({ ...baseInfo, node: infoItem.node, start: infoItem.start, end: infoItem.end })
        }

        drawMarkSuccess = infos.length > 0
      }

      return drawMarkSuccess
    } catch (error) {
      console.error('Failed to draw mark:', error)
      return false
    }
  }

  /**
   * 将标记路径项转换为节点信息
   */
  private transferNodeInfos(markItem: MarkPathItem): Array<
    | { start: number; end: number; node: Node; type: 'text' }
    | { type: 'image'; ele: HTMLImageElement }
  > {
    const infos: (
      | { start: number; end: number; node: Node; type: 'text' }
      | { type: 'image'; ele: HTMLImageElement }
    )[] = []

    if (markItem.type === 'text') {
      const baseElement = this.container.querySelector(markItem.path) as HTMLElement
      if (!baseElement) {
        return infos
      }

      const nodes = getAllTextNodes(baseElement)
      const nodeLengths = nodes.map((node) => (node.textContent || '').length)

      let startOffset = markItem.start || 0
      const endOffset = markItem.end || 0
      let base = 0

      for (let i = 0; i < nodeLengths.length; i++) {
        if (base + nodeLengths[i] <= startOffset) {
          base += nodeLengths[i]
          continue
        }
        if (endOffset - base <= nodeLengths[i]) {
          infos.push({ type: 'text', start: startOffset - base, end: endOffset - base, node: nodes[i] })
          break
        } else {
          infos.push({ type: 'text', start: startOffset - base, end: nodeLengths[i], node: nodes[i] })
          startOffset += nodeLengths[i] - (startOffset - base)
          base += nodeLengths[i]
        }
      }
    } else if (markItem.type === 'image') {
      let element = this.container.querySelector(markItem.path) as HTMLImageElement
      if (!element || !element.src) {
        // 尝试在slax-mark标签内查找
        const paths = markItem.path.split('>')
        const tailIdx = paths.length - 1
        const newPath = [...paths.slice(0, tailIdx), ' slax-mark ', paths[tailIdx]]
        element = this.container.querySelector(newPath.join('>')) as HTMLImageElement
      }
      if (element) {
        infos.push({ type: 'image', ele: element })
      }
    }

    return infos
  }

  /**
   * 在文本节点上添加标记
   */
  private addMark(info: DrawMarkInfo & { node: Node; start: number; end: number }): void {
    const { id, node, start, end, isStroke, hasComment, isSelfStroke, isHighlighted } = info
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)

    const mark = document.createElement('slax-mark')
    mark.dataset.uuid = id

    if (isStroke) mark.classList.add('stroke')
    if (hasComment) mark.classList.add('comment')
    if (isSelfStroke) mark.classList.add('self-stroke')
    if (isHighlighted) mark.classList.add('highlighted')

    // 直接在元素上绑定 touchend，避免容器级别委托时 event.target 不可靠的问题
    if (this.onMarkTap) {
      const tapCallback = this.onMarkTap
      mark.addEventListener('touchend', (e: TouchEvent) => tapCallback(id, e))
    }

    try {
      range.surroundContents(mark)
    } catch (error) {
      console.error('Failed to surround contents:', error)
    }
  }

  /**
   * 添加图片标记
   */
  private addImageMark(info: DrawMarkInfo & { ele: HTMLImageElement }): void {
    const { id, ele, isStroke, hasComment, isSelfStroke, isHighlighted } = info
    const mark = document.createElement('slax-mark')
    mark.dataset.uuid = id

    if (isStroke) mark.classList.add('stroke')
    if (hasComment) mark.classList.add('comment')
    if (isSelfStroke) mark.classList.add('self-stroke')
    if (isHighlighted) mark.classList.add('highlighted')

    // 直接在元素上绑定 touchend
    if (this.onMarkTap) {
      const tapCallback = this.onMarkTap
      mark.addEventListener('touchend', (e: TouchEvent) => tapCallback(id, e))
    }

    ele.parentElement?.insertBefore(mark, ele)
    ele.remove()
    mark.appendChild(ele)
  }

  /**
   * 更新标记
   */
  updateMark(id: string, isStroke: boolean, hasComment: boolean, userId?: number): void {
    const marks = Array.from(this.container.querySelectorAll(`slax-mark[data-uuid="${id}"]`))
    const isSelfStroke = userId !== undefined && userId === this.currentUserId

    marks.forEach((mark) => {
      if (isStroke) {
        mark.classList.add('stroke')
      } else {
        mark.classList.remove('stroke')
      }

      if (hasComment) {
        mark.classList.add('comment')
      } else {
        mark.classList.remove('comment')
      }

      if (isSelfStroke) {
        mark.classList.add('self-stroke')
      } else {
        mark.classList.remove('self-stroke')
      }

      // 如果既没有划线也没有评论，删除标记
      if (!isStroke && !hasComment) {
        removeOuterTag(mark)
      }
    })
  }

  /**
   * 删除标记
   */
  removeMark(id: string): void {
    const marks = Array.from(this.container.querySelectorAll(`slax-mark[data-uuid="${id}"]`))
    marks.forEach((mark) => removeOuterTag(mark))
  }

  /**
   * 高亮标记
   */
  highlightMark(id: string): void {
    this.clearAllHighlights()

    const marks = Array.from(this.container.querySelectorAll(`slax-mark[data-uuid="${id}"]`))
    marks.forEach((mark) => mark.classList.add('highlighted'))

    if (marks.length > 0) {
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  /**
   * 清除所有高亮
   */
  clearAllHighlights(): void {
    const marks = Array.from(this.container.querySelectorAll('slax-mark.highlighted'))
    marks.forEach((mark) => mark.classList.remove('highlighted'))
  }

  /**
   * 清除所有标记
   */
  clearAllMarks(): void {
    const marks = Array.from(this.container.querySelectorAll('slax-mark'))
    marks.forEach((mark) => removeOuterTag(mark))
  }

  /**
   * 获取所有标记ID
   */
  getAllMarkIds(): string[] {
    const marks = Array.from(this.container.querySelectorAll('slax-mark[data-uuid]'))
    const ids = new Set<string>()

    marks.forEach((mark) => {
      const id = (mark as HTMLElement).dataset.uuid
      if (id) ids.add(id)
    })

    return Array.from(ids)
  }
}
