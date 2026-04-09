import type {
  MarkDetail,
  BackendMarkInfo,
  MarkUserInfo,
  MarkCommentInfo,
  MarkItemInfo,
  MarkPathItem,
  MarkPathApprox,
  DrawMarksResult,
  UserList
} from '../types/selection'
import { generateUUID, deepEqual, getRangeTextWithNewlines, getElementPath, getAllTextNodes } from '../utils/selection-utils'
import { MarkRenderer } from './mark-renderer'

/**
 * 标记管理器
 *
 * 负责处理后端 MarkDetail 数据的预处理、分组和渲染
 */
export class MarkManager {
  private container: HTMLElement
  private renderer: MarkRenderer
  private markItemInfos: MarkItemInfo[] = []

  constructor(container: HTMLElement, currentUserId?: number) {
    this.container = container
    this.renderer = new MarkRenderer(container, currentUserId)
  }

  /**
   * 绘制多个标记
   *
   * @param marks 后端返回的 MarkDetail 数据
   * @returns 键值对：uuid -> 该uuid对应的后端mark列表
   */
  drawMarks(marks: MarkDetail): DrawMarksResult {
    const userMap = this.createUserMap(marks.user_list)
    const commentMap = this.buildCommentMap(marks.mark_list, userMap)
    this.buildCommentRelationships(marks.mark_list, commentMap)
    this.markItemInfos = this.generateMarkItemInfos(marks.mark_list, commentMap)

    for (const info of this.markItemInfos) {
      this.drawSingleMarkItem(info)
    }

    return this.buildDrawMarksResult(marks.mark_list)
  }

  /**
   * 根据 UUID 删除标记
   */
  removeMarkByUuid(uuid: string): void {
    this.renderer.removeMark(uuid)
    this.markItemInfos = this.markItemInfos.filter((info) => info.id !== uuid)
  }

  /**
   * 清除所有标记
   */
  clearAllMarks(): void {
    this.renderer.clearAllMarks()
    this.markItemInfos = []
  }

  /**
   * 高亮指定UUID的标记
   */
  highlightMark(uuid: string): void {
    this.renderer.highlightMark(uuid)
  }

  /**
   * 清除所有高亮
   */
  clearAllHighlights(): void {
    this.renderer.clearAllHighlights()
  }

  /**
   * 获取所有标记ID
   */
  getAllMarkIds(): string[] {
    return this.renderer.getAllMarkIds()
  }

  /**
   * 步骤1：创建用户映射
   */
  private createUserMap(userList: UserList): Map<number, MarkUserInfo> {
    return new Map(Object.entries(userList).map(([key, value]) => [Number(key), value]))
  }

  /**
   * 步骤2：构建评论映射
   */
  private buildCommentMap(
    markList: BackendMarkInfo[],
    userMap: Map<number, MarkUserInfo>
  ): Map<number, MarkCommentInfo> {
    const commentMap = new Map<number, MarkCommentInfo>()

    const COMMENT_TYPES = [2, 3, 5] // COMMENT, REPLY, ORIGIN_COMMENT

    for (const mark of markList) {
      if (COMMENT_TYPES.includes(mark.type)) {
        const user = userMap.get(mark.user_id)
        const comment: MarkCommentInfo = {
          markId: mark.id,
          comment: mark.comment,
          userId: mark.user_id,
          username: user?.username || '',
          avatar: user?.avatar || '',
          isDeleted: mark.is_deleted,
          children: [],
          createdAt:
            typeof mark.created_at === 'string' ? new Date(mark.created_at) : mark.created_at,
          rootId: mark.root_id,
          showInput: false,
          loading: false,
          operateLoading: false
        }
        commentMap.set(mark.id, comment)
      }
    }

    return commentMap
  }

  /**
   * 步骤3：构建评论关系（回复的父子关系）
   */
  private buildCommentRelationships(
    markList: BackendMarkInfo[],
    commentMap: Map<number, MarkCommentInfo>
  ): void {
    const REPLY_TYPE = 3

    for (const mark of markList) {
      if (mark.type !== REPLY_TYPE) continue
      if (
        !commentMap.has(mark.id) ||
        !commentMap.has(mark.parent_id) ||
        !commentMap.has(mark.root_id)
      )
        continue

      const comment = commentMap.get(mark.id)!
      const parentComment = commentMap.get(mark.parent_id)!

      comment.reply = {
        id: parentComment.markId,
        username: parentComment.username,
        userId: parentComment.userId,
        avatar: parentComment.avatar
      }

      const rootComment = commentMap.get(mark.root_id)
      if (rootComment) {
        rootComment.children.push(comment)
      }
    }
  }

  /**
   * 步骤4：生成 MarkItemInfo 列表（按source分组）
   */
  private generateMarkItemInfos(
    markList: BackendMarkInfo[],
    commentMap: Map<number, MarkCommentInfo>
  ): MarkItemInfo[] {
    const infoItems: MarkItemInfo[] = []

    const LINE_TYPES = [1, 4] // LINE, ORIGIN_LINE
    const COMMENT_TYPES = [2, 5] // COMMENT, ORIGIN_COMMENT
    const ORIGIN_TYPES = [4, 5] // ORIGIN_LINE, ORIGIN_COMMENT
    const REPLY_TYPE = 3

    for (const mark of markList) {
      const source = mark.source

      // 跳过 REPLY 类型和数字类型的 source
      if (typeof source === 'number' || mark.type === REPLY_TYPE) continue

      // 跳过没有 approx_source 的原始标记
      if (
        ORIGIN_TYPES.includes(mark.type) &&
        (!mark.approx_source || Object.keys(mark.approx_source).length === 0)
      ) {
        continue
      }

      const markSources = source as MarkPathItem[]

      let markInfoItem = infoItems.find((infoItem) =>
        this.checkMarkSourceIsSame(infoItem.source, markSources)
      )

      if (!markInfoItem) {
        if (mark.approx_source) {
          try {
            const newRange = this.getRangeFromApprox(mark.approx_source)
            const rawText = newRange ? getRangeTextWithNewlines(newRange) : undefined
            mark.approx_source.raw_text = rawText
          } catch (error) {
            console.error('create raw text failed', error, mark.approx_source?.exact)
          }
        }

        markInfoItem = {
          id: generateUUID(),
          source: markSources,
          comments: [],
          stroke: [],
          approx: mark.approx_source
        }
        infoItems.push(markInfoItem)
      }

      if (LINE_TYPES.includes(mark.type)) {
        markInfoItem.stroke.push({ mark_id: mark.id, userId: mark.user_id })
      } else if (COMMENT_TYPES.includes(mark.type)) {
        const comment = commentMap.get(mark.id)
        if (!comment || (comment.isDeleted && comment.children.length === 0)) {
          continue
        }
        markInfoItem.comments.push(comment)
      }
    }

    return infoItems
  }

  /**
   * 对当前选中区域执行划线处理
   *
   * 读取 window.getSelection() → 解析路径和 approx → 构建 MarkItemInfo → 渲染划线
   *
   * 注意：此方法不调用后端 API，只在本地渲染。
   * 调用方在拿到后端 mark_id 后，可通过返回的 uuid 调用 updateMarkIdByUuid 更新关联信息。
   *
   * @param userId 当前用户ID（可选）
   * @returns 新建 MarkItemInfo 的 uuid，若选区无效则返回 null
   */
  strokeCurrentSelection(userId?: number): string | null {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null

    const range = selection.getRangeAt(0)
    if (range.collapsed) return null

    if (!this.container.contains(range.commonAncestorContainer)) return null

    // 解析路径
    const paths = this.parseRangeToPaths(range)
    if (paths.length === 0) return null

    // 解析 approx
    const approx = this.parseApproxFromRange(range)

    // 检查是否已存在相同 source 的 MarkItemInfo
    const existing = this.markItemInfos.find((info) => this.checkMarkSourceIsSame(info.source, paths))
    if (existing) {
      // 已存在则直接在已有条目上追加 stroke（幂等处理）
      const alreadyStroked = existing.stroke.some((s) => s.userId === (userId ?? 0))
      if (!alreadyStroked) {
        existing.stroke.push({ mark_id: undefined, userId: userId ?? 0 })
        this.drawSingleMarkItem(existing)
      }
      return existing.id
    }

    // 构建新的 MarkItemInfo
    const uuid = generateUUID()
    const infoItem: MarkItemInfo = {
      id: uuid,
      source: paths,
      stroke: [{ mark_id: undefined, userId: userId ?? 0 }],
      comments: [],
      approx
    }

    this.markItemInfos.push(infoItem)
    this.drawSingleMarkItem(infoItem)

    return uuid
  }

  /**
   * 通过 uuid 找到对应的 MarkItemInfo，并将其 stroke 中 mark_id 为空的项更新为指定 mark_id
   *
   * 用于在后端 API 返回 mark_id 后，将本地临时记录与后端数据关联
   *
   * @param uuid MarkItemInfo 的 uuid（由 strokeCurrentSelection 返回）
   * @param markId 后端返回的 mark_id
   * @param userId 用户ID（用于精确匹配对应 stroke 条目，可选）
   */
  updateMarkIdByUuid(uuid: string, markId: number, userId?: number): void {
    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) return

    const stroke = infoItem.stroke.find((s) => !s.mark_id && (userId === undefined || s.userId === userId))
    if (stroke) {
      stroke.mark_id = markId
    }
  }

  /**
   * 将 Range 转换为 MarkPathItem 数组
   */
  private parseRangeToPaths(range: Range): MarkPathItem[] {
    const paths: MarkPathItem[] = []
    let currentPath: string | null = null
    let currentStart = 0
    let currentEnd = 0

    const selectedInfo = this.getSelectionInfoFromRange(range)

    for (const item of selectedInfo) {
      if (item.type === 'text') {
        let parent = (item.node as Node).parentElement
        while (parent && parent.tagName === 'SLAX-MARK') {
          parent = parent.parentElement
        }
        if (!parent) continue

        const path = getElementPath(parent, this.container)
        const allTextNodes = getAllTextNodes(parent)
        let offset = 0
        for (const textNode of allTextNodes) {
          if (textNode === item.node) break
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
   * 从 Range 获取选区信息（文本节点 + 图片列表）
   */
  private getSelectionInfoFromRange(range: Range): Array<
    | { type: 'text'; node: Node; startOffset: number; endOffset: number }
    | { type: 'image'; element: HTMLImageElement }
  > {
    const result: Array<
      | { type: 'text'; node: Node; startOffset: number; endOffset: number }
      | { type: 'image'; element: HTMLImageElement }
    > = []

    const isFullyInRange = (node: Node) => {
      const nr = document.createRange()
      nr.selectNodeContents(node)
      return (
        range.compareBoundaryPoints(Range.START_TO_START, nr) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, nr) >= 0
      )
    }

    const partiallyInRange = (node: Node) => range.intersectsNode(node)

    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim() || '').length > 0) {
        if (!partiallyInRange(node)) return
        let startOffset = node === range.startContainer ? range.startOffset : 0
        let endOffset = node === range.endContainer ? range.endOffset : (node as Text).length
        startOffset = Math.max(0, Math.min(startOffset, (node as Text).length))
        endOffset = Math.max(startOffset, Math.min(endOffset, (node as Text).length))
        if (endOffset > startOffset) {
          result.push({ type: 'text', node, startOffset, endOffset })
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        if (el.tagName === 'IMG' && isFullyInRange(el)) {
          result.push({ type: 'image', element: el as HTMLImageElement })
        }
        if (partiallyInRange(el)) {
          for (const child of Array.from(el.childNodes)) processNode(child)
        }
      }
    }

    processNode(range.commonAncestorContainer)
    return result
  }

  /**
   * 从 Range 中提取 approx 近似匹配信息
   */
  private parseApproxFromRange(range: Range): MarkPathApprox {
    const exact = getRangeTextWithNewlines(range)

    const prefixRange = document.createRange()
    prefixRange.setStart(this.container, 0)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const fullPrefix = getRangeTextWithNewlines(prefixRange)
    const prefix = fullPrefix.slice(-50)

    const suffixRange = document.createRange()
    suffixRange.setStart(range.endContainer, range.endOffset)
    if (this.container.lastChild) {
      suffixRange.setEndAfter(this.container.lastChild)
    }
    const fullSuffix = getRangeTextWithNewlines(suffixRange)
    const suffix = fullSuffix.slice(0, 50)

    return { exact, prefix, suffix, raw_text: exact }
  }

  /**
   * 检查两个 source 是否相同
   */
  private checkMarkSourceIsSame(source1: MarkPathItem[], source2: MarkPathItem[]): boolean {
    return deepEqual(source1, source2)
  }

  /**
   * 从 approx 信息获取 Range（占位实现）
   */
  private getRangeFromApprox(_approx: any): Range | null {
    return null
  }

  /**
   * 渲染单个 MarkItemInfo
   */
  private drawSingleMarkItem(info: MarkItemInfo): void {
    const hasStroke = info.stroke.length > 0
    const hasComment = info.comments.length > 0
    const userId =
      info.stroke.length > 0 ? info.stroke[0].userId : info.comments[0]?.userId

    this.renderer.drawMark(info.id, info.source, hasStroke, hasComment, userId)
  }

  /**
   * 构建返回结果：uuid -> BackendMarkInfo[]
   */
  private buildDrawMarksResult(markList: BackendMarkInfo[]): DrawMarksResult {
    const result: DrawMarksResult = {}

    for (const itemInfo of this.markItemInfos) {
      const relatedMarks: BackendMarkInfo[] = []

      for (const stroke of itemInfo.stroke) {
        if (stroke.mark_id) {
          const mark = markList.find((m) => m.id === stroke.mark_id)
          if (mark) relatedMarks.push(mark)
        }
      }

      for (const comment of itemInfo.comments) {
        const mark = markList.find((m) => m.id === comment.markId)
        if (mark) relatedMarks.push(mark)

        for (const child of comment.children) {
          const childMark = markList.find((m) => m.id === child.markId)
          if (childMark) relatedMarks.push(childMark)
        }
      }

      result[itemInfo.id] = relatedMarks
    }

    return result
  }
}
