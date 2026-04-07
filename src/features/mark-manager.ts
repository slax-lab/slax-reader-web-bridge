import type {
  MarkDetail,
  BackendMarkInfo,
  MarkUserInfo,
  MarkCommentInfo,
  MarkItemInfo,
  MarkPathItem,
  DrawMarksResult,
  UserList
} from '../types/selection'
import { generateUUID, deepEqual, getRangeTextWithNewlines } from '../utils/selection-utils'
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
