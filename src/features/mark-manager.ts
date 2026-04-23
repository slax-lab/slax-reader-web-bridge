import type {
  MarkDetail,
  BackendMarkInfo,
  MarkUserInfo,
  MarkCommentInfo,
  MarkItemInfo,
  MarkPathItem,
  MarkPathApprox,
  DrawMarksResult,
  UserList,
  StrokeCreateData,
  StrokeCreateSource,
  StrokeCreateSelectContent,
  StrokeCreateApproxSource
} from '../types/selection'
import { generateUUID, deepEqual, getRangeTextWithNewlines, getElementPath, getAllTextNodes } from '../utils/selection-utils'
import search from 'approx-string-match'
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

  /** markItemInfos 数据变化时的回调，返回完整的 markItemInfos 数组 */
  private onMarkItemInfosChange?: (markItemInfos: MarkItemInfo[]) => void

  /** 抑制变化通知（用于内部连续操作避免重复通知） */
  private _suppressChangeNotification = false

  constructor(
    container: HTMLElement,
    currentUserId?: number,
    onMarkTap?: (markId: string, event: TouchEvent) => void,
    onMarkItemInfosChange?: (markItemInfos: MarkItemInfo[]) => void
  ) {
    this.container = container
    this.renderer = new MarkRenderer(container, currentUserId, onMarkTap)
    this.onMarkItemInfosChange = onMarkItemInfosChange
  }

  /**
   * 根据选区 paths 解析对应的 MarkItemInfo
   *
   * 如果与已有的 MarkItemInfo 的 source 完全匹配，则返回该 MarkItemInfo；
   * 否则创建一个临时的 MarkItemInfo。
   */
  resolveMarkItemInfo(paths: MarkPathItem[], approx?: MarkPathApprox): MarkItemInfo | null {

    if (paths.length === 0) {
      return null
    }

    const existing = this.markItemInfos.find((info) =>
      this.checkMarkSourceIsSame(info.source, paths)
    )

    if (existing) {
      if (!existing.approx && approx) {
        existing.approx = approx
      }
      return existing
    }

    const created: MarkItemInfo = {
      id: '',
      source: paths,
      comments: [],
      stroke: [],
      approx
    }
    return created
  }

  /**
   * 通知外部 markItemInfos 数据已变化
   */
  private notifyMarkItemInfosChanged(): void {
    if (this._suppressChangeNotification) return
    this.onMarkItemInfosChange?.([...this.markItemInfos])
  }

  /**
   * 绘制多个标记
   *
   * @param marks 后端返回的 MarkDetail 数据
   * @returns 键值对：uuid -> 该uuid对应的后端mark列表
   */
  drawMarks(marks: MarkDetail): DrawMarksResult {
    // 保留旧的 markItemInfos，用于在重新生成时复用已有的 id
    const previousMarkItemInfos = this.markItemInfos

    this._suppressChangeNotification = true
    this.clearAllMarks()
    this._suppressChangeNotification = false

    const userMap = this.createUserMap(marks.user_list)
    const commentMap = this.buildCommentMap(marks.mark_list, userMap)
    this.buildCommentRelationships(marks.mark_list, commentMap)

    console.log('[MarkManager] drawMarks 变动前 markItemInfos（共 %d 条）:', previousMarkItemInfos.length, JSON.parse(JSON.stringify(previousMarkItemInfos)))
    this.markItemInfos = this.generateMarkItemInfos(marks.mark_list, commentMap, previousMarkItemInfos)
    console.log('[MarkManager] drawMarks 变动后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))

    for (const info of this.markItemInfos) {
      this.drawSingleMarkItem(info)
    }

    this.notifyMarkItemInfosChanged()

    return this.buildDrawMarksResult(marks.mark_list)
  }

  /**
   * 根据 UUID 删除标记
   */
  removeMarkByUuid(uuid: string): void {
    console.log('[MarkManager] removeMarkByUuid 变动前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    this.renderer.removeMark(uuid)
    this.markItemInfos = this.markItemInfos.filter((info) => info.id !== uuid)
    console.log('[MarkManager] removeMarkByUuid 变动后 markItemInfos（共 %d 条），已移除 uuid:', this.markItemInfos.length, uuid, JSON.parse(JSON.stringify(this.markItemInfos)))

    this.notifyMarkItemInfosChanged()
  }

  /**
   * 根据本地 UUID 获取 MarkItemInfo
   */
  getMarkItemInfoByUuid(uuid: string): MarkItemInfo | null {
    return this.markItemInfos.find((info) => info.id === uuid) ?? null
  }

  /**
   * 清除所有标记
   */
  clearAllMarks(): void {
    console.log('[MarkManager] clearAllMarks 变动前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    this.renderer.clearAllMarks()
    this.markItemInfos = []
    console.log('[MarkManager] clearAllMarks 变动后 markItemInfos 已清空（共 0 条）')

    this.notifyMarkItemInfosChanged()
  }

  /**
   * 根据 UUID 为指定用户添加划线
   *
   * 在对应 MarkItemInfo 的 stroke 数组中追加一条记录，并重新渲染该标记的 DOM 样式。
   * 如果该用户已有划线，则跳过（幂等）。
   *
   * @param uuid MarkItemInfo 的本地 UUID
   * @param userId 执行划线的用户ID
   * @returns 是否成功添加（false 表示 uuid 不存在或用户已有划线）
   */
  addStrokeByUuid(uuid: string, userId: number): boolean {
    console.log('[MarkManager] addStrokeByUuid 入参 → uuid:', uuid, 'userId:', userId)
    console.log('[MarkManager] addStrokeByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))

    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] addStrokeByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      console.log('[MarkManager] addStrokeByUuid 出参 → false（uuid 不存在）')
      return false
    }

    console.log('[MarkManager] addStrokeByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)))
    console.log('[MarkManager] addStrokeByUuid 当前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)))

    const alreadyStroked = infoItem.stroke.some((s) => s.userId === userId)
    if (alreadyStroked) {
      console.log('[MarkManager] addStrokeByUuid 用户已有划线，跳过，uuid:', uuid, 'userId:', userId)
      console.log('[MarkManager] addStrokeByUuid 出参 → false（用户已有划线）')
      return false
    }

    console.log('[MarkManager] addStrokeByUuid 变动前 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)))
    infoItem.stroke.push({ mark_id: undefined, userId })
    console.log('[MarkManager] addStrokeByUuid 变动后 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)))

    this.updateMarkItemUI(infoItem)
    this.notifyMarkItemInfosChanged()

    console.log('[MarkManager] addStrokeByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    console.log('[MarkManager] addStrokeByUuid 出参 → true')
    return true
  }

  /**
   * 根据 UUID 删除指定用户的划线
   *
   * 从对应 MarkItemInfo 的 stroke 数组中移除该用户的记录，并重新渲染 DOM 样式。
   * 如果移除后 stroke 和 comments 均为空，则整体删除该标记。
   *
   * @param uuid MarkItemInfo 的本地 UUID
   * @param userId 要删除划线的用户ID
   * @returns 是否成功删除（false 表示 uuid 不存在或该用户无划线）
   */
  removeStrokeByUuid(uuid: string, userId: number): boolean {
    console.log('[MarkManager] removeStrokeByUuid 入参 → uuid:', uuid, 'userId:', userId)
    console.log('[MarkManager] removeStrokeByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))

    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] removeStrokeByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      console.log('[MarkManager] removeStrokeByUuid 出参 → false（uuid 不存在）')
      return false
    }

    console.log('[MarkManager] removeStrokeByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)))
    console.log('[MarkManager] removeStrokeByUuid 当前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)))

    const strokeIndex = infoItem.stroke.findIndex((s) => s.userId === userId)
    if (strokeIndex === -1) {
      console.log('[MarkManager] removeStrokeByUuid 该用户无划线，跳过，uuid:', uuid, 'userId:', userId)
      console.log('[MarkManager] removeStrokeByUuid 出参 → false（用户无划线）')
      return false
    }

    console.log('[MarkManager] removeStrokeByUuid 变动前 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)))
    console.log('[MarkManager] removeStrokeByUuid 即将移除 stroke[%d]:', strokeIndex, JSON.parse(JSON.stringify(infoItem.stroke[strokeIndex])))
    infoItem.stroke.splice(strokeIndex, 1)
    console.log('[MarkManager] removeStrokeByUuid 变动后 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)))

    if (infoItem.stroke.length === 0 && infoItem.comments.length === 0) {
      console.log('[MarkManager] removeStrokeByUuid 标记已无划线和评论，整体删除，uuid:', uuid)
      console.log('[MarkManager] removeStrokeByUuid 删除前 markItemInfos（共 %d 条）:', this.markItemInfos.length)
      this._suppressChangeNotification = true
      this.removeMarkByUuid(uuid)
      this._suppressChangeNotification = false
      console.log('[MarkManager] removeStrokeByUuid 删除后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    } else {
      this.updateMarkItemUI(infoItem)
      console.log('[MarkManager] removeStrokeByUuid 更新UI完成，剩余 stroke: %d, comments: %d', infoItem.stroke.length, infoItem.comments.length)
    }

    console.log('[MarkManager] removeStrokeByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    console.log('[MarkManager] removeStrokeByUuid 出参 → true')

    this.notifyMarkItemInfosChanged()

    return true
  }

  /**
   * 根据 UUID 添加评论
   *
   * 在对应 MarkItemInfo 的 comments 数组中追加一条评论记录，并重新渲染 DOM 样式。
   *
   * @param uuid MarkItemInfo 的本地 UUID
   * @param userId 发表评论的用户ID
   * @param comment 评论内容
   * @returns 是否成功添加（false 表示 uuid 不存在）
   */
  addCommentByUuid(uuid: string, userId: number, comment: string): boolean {
    console.log('[MarkManager] addCommentByUuid 入参 → uuid:', uuid, 'userId:', userId, 'comment:', comment)
    console.log('[MarkManager] addCommentByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))

    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] addCommentByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      return false
    }

    console.log('[MarkManager] addCommentByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)))
    console.log('[MarkManager] addCommentByUuid 变动前 comments（共 %d 条）:', infoItem.comments.length, JSON.parse(JSON.stringify(infoItem.comments)))

    const commentInfo: MarkCommentInfo = {
      markId: 0,
      comment,
      userId,
      username: '',
      avatar: '',
      isDeleted: false,
      children: [],
      createdAt: new Date(),
      showInput: false,
      loading: false,
      operateLoading: false
    }

    infoItem.comments.push(commentInfo)
    console.log('[MarkManager] addCommentByUuid 变动后 comments（共 %d 条）:', infoItem.comments.length, JSON.parse(JSON.stringify(infoItem.comments)))

    this.updateMarkItemUI(infoItem)
    this.notifyMarkItemInfosChanged()

    console.log('[MarkManager] addCommentByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    return true
  }

  /**
   * 更新单个 MarkItemInfo 对应的 DOM 样式
   *
   * 根据当前 stroke 和 comments 的状态，通过 renderer.updateMark 刷新 slax-mark 的 CSS class。
   */
  private updateMarkItemUI(info: MarkItemInfo): void {
    const hasStroke = info.stroke.length > 0
    const hasComment = info.comments.length > 0
    const userId =
      info.stroke.length > 0 ? info.stroke[0].userId : info.comments[0]?.userId

    this.renderer.updateMark(info.id, hasStroke, hasComment, userId)
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
    commentMap: Map<number, MarkCommentInfo>,
    previousMarkItemInfos: MarkItemInfo[] = []
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

      if (markInfoItem && !markInfoItem.approx && mark.approx_source) {
        try {
          const newRange = this.getRangeFromApprox(mark.approx_source)
          const rawText = newRange ? getRangeTextWithNewlines(newRange) : undefined
          mark.approx_source.raw_text = rawText
        } catch (error) {
          console.error('create raw text failed', error, mark.approx_source?.exact)
        }
        markInfoItem.approx = mark.approx_source
      }

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

        // 从旧的 markItemInfos 中查找相同 source 的项，复用其 id，
        // 避免重新渲染后 id 变化导致外部持有的引用失效
        const previousItem = previousMarkItemInfos.find((prev) =>
          this.checkMarkSourceIsSame(prev.source, markSources)
        )

        markInfoItem = {
          id: previousItem?.id ?? generateUUID(),
          source: markSources,
          comments: [],
          stroke: [],
          approx: mark.approx_source
        }
        infoItems.push(markInfoItem)
      }

      if (LINE_TYPES.includes(mark.type)) {
        if (!mark.comment && mark.is_deleted) continue
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
   * 返回值包含调用 /v1/mark/create 接口所需的全部字段，以及用于后续关联的 uuid。
   * 拿到后端 mark_id 后，调用 updateMarkIdByUuid 完成关联。
   *
   * @param userId 当前用户ID（可选）
   * @returns StrokeCreateData（含 uuid 及接口入参），若选区无效则返回 null
   */
  strokeCurrentSelection(userId?: number): StrokeCreateData | null {
    console.log('[MarkManager] strokeCurrentSelection 开始，userId:', userId)

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      console.log('[MarkManager] strokeCurrentSelection 终止：无选区')
      return null
    }

    const range = selection.getRangeAt(0)
    if (range.collapsed) {
      console.log('[MarkManager] strokeCurrentSelection 终止：选区已折叠')
      return null
    }

    if (!this.container.contains(range.commonAncestorContainer)) {
      console.log('[MarkManager] strokeCurrentSelection 终止：选区不在容器内')
      return null
    }

    // 一次性解析选区内的节点信息，后续各步骤共用
    const selectionInfo = this.getSelectionInfoFromRange(range)
    console.log('[MarkManager] strokeCurrentSelection selectionInfo 解析结果，数量:', selectionInfo.length, selectionInfo)
    if (selectionInfo.length === 0) {
      console.log('[MarkManager] strokeCurrentSelection 终止：selectionInfo 为空')
      return null
    }

    // 解析渲染所需的路径（MarkPathItem[]）
    const paths = this.buildPathsFromSelectionInfo(selectionInfo)
    console.log('[MarkManager] strokeCurrentSelection paths 解析结果，数量:', paths.length, paths)
    if (paths.length === 0) {
      console.log('[MarkManager] strokeCurrentSelection 终止：paths 为空')
      return null
    }

    // 解析 approx（同时得到接口格式的 approx_source，含 position_start/position_end）
    const { approx, approxCreate } = this.parseApproxFromRange(range)
    console.log('[MarkManager] strokeCurrentSelection approx:', approx, 'approxCreate:', approxCreate)

    // 构建接口所需的 select_content
    const selectContent = this.buildSelectContent(selectionInfo)
    console.log('[MarkManager] strokeCurrentSelection selectContent:', selectContent)

    // 接口所需的 source（xpath 格式）
    const apiSource = this.convertToApiSource(paths)
    console.log('[MarkManager] strokeCurrentSelection apiSource:', apiSource)

    // 检查是否已存在相同 source 的 MarkItemInfo（幂等处理）
    const existing = this.markItemInfos.find((info) => this.checkMarkSourceIsSame(info.source, paths))
    if (existing) {
      console.log('[MarkManager] strokeCurrentSelection 命中已有 MarkItemInfo，uuid:', existing.id)
      const alreadyStroked = existing.stroke.some((s) => s.userId === (userId ?? 0))
      if (!alreadyStroked) {
        console.log('[MarkManager] strokeCurrentSelection 当前用户尚未划线，追加 stroke')
        console.log('[MarkManager] strokeCurrentSelection 变动前 existing.stroke:', JSON.parse(JSON.stringify(existing.stroke)))
        existing.stroke.push({ mark_id: undefined, userId: userId ?? 0 })
        console.log('[MarkManager] strokeCurrentSelection 变动后 existing.stroke:', JSON.parse(JSON.stringify(existing.stroke)))
        console.log('[MarkManager] strokeCurrentSelection 变动后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
        this.drawSingleMarkItem(existing)
        this.notifyMarkItemInfosChanged()
      } else {
        console.log('[MarkManager] strokeCurrentSelection 当前用户已有划线，跳过渲染')
      }
      return {
        uuid: existing.id,
        source: apiSource,
        select_content: selectContent,
        approx_source: approxCreate
      }
    }

    // 构建新的 MarkItemInfo 并渲染
    const uuid = generateUUID()
    console.log('[MarkManager] strokeCurrentSelection 创建新 MarkItemInfo，uuid:', uuid)
    const infoItem: MarkItemInfo = {
      id: uuid,
      source: paths,
      stroke: [{ mark_id: undefined, userId: userId ?? 0 }],
      comments: [],
      approx
    }

    console.log('[MarkManager] strokeCurrentSelection 变动前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    this.markItemInfos.push(infoItem)
    console.log('[MarkManager] strokeCurrentSelection 变动后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    this.drawSingleMarkItem(infoItem)
    this.notifyMarkItemInfosChanged()

    const result: StrokeCreateData = {
      uuid,
      source: apiSource,
      select_content: selectContent,
      approx_source: approxCreate
    }
    console.log('[MarkManager] strokeCurrentSelection 完成，返回:', result)
    return result
  }

  /**
   * 获取当前选区数据
   *
   * 与 strokeCurrentSelection 类似，但不执行渲染和幂等处理，
   * 仅读取当前选区并返回接口所需的数据结构。
   *
   * @returns StrokeCreateData（不含 uuid），若选区无效则返回 null
   */
  captureCurrentSelection(): { source: StrokeCreateSource[]; select_content: StrokeCreateSelectContent[]; approx_source: StrokeCreateApproxSource } | null {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null

    const range = selection.getRangeAt(0)
    if (range.collapsed) return null

    if (!this.container.contains(range.commonAncestorContainer)) return null

    const selectionInfo = this.getSelectionInfoFromRange(range)
    if (selectionInfo.length === 0) return null

    const paths = this.buildPathsFromSelectionInfo(selectionInfo)
    if (paths.length === 0) return null

    const { approxCreate } = this.parseApproxFromRange(range)
    const selectContent = this.buildSelectContent(selectionInfo)
    const apiSource = this.convertToApiSource(paths)

    return {
      source: apiSource,
      select_content: selectContent,
      approx_source: approxCreate
    }
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
    console.log('[MarkManager] updateMarkIdByUuid 入参 → uuid:', uuid, 'markId:', markId, 'userId:', userId)
    console.log('[MarkManager] updateMarkIdByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))

    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] updateMarkIdByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      console.log('[MarkManager] updateMarkIdByUuid 出参 → void（uuid 不存在，未做任何变更）')
      return
    }

    console.log('[MarkManager] updateMarkIdByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)))
    console.log('[MarkManager] updateMarkIdByUuid 变动前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)))

    const stroke = infoItem.stroke.find((s) => !s.mark_id && (userId === undefined || s.userId === userId))
    if (stroke) {
      console.log('[MarkManager] updateMarkIdByUuid 找到匹配 stroke，更新前:', JSON.parse(JSON.stringify(stroke)))
      stroke.mark_id = markId
      console.log('[MarkManager] updateMarkIdByUuid 更新后 stroke:', JSON.parse(JSON.stringify(stroke)))
      this.notifyMarkItemInfosChanged()
    } else {
      console.warn('[MarkManager] updateMarkIdByUuid 未找到可更新的 stroke（mark_id 为空且 userId 匹配）', 'userId 过滤条件:', userId)
    }

    console.log('[MarkManager] updateMarkIdByUuid 变动后 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)))
    console.log('[MarkManager] updateMarkIdByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))
    console.log('[MarkManager] updateMarkIdByUuid 出参 → void（完成）')
  }

  /**
   * 将 Range 转换为 MarkPathItem 数组
   *
   * @deprecated 内部请改用 buildPathsFromSelectionInfo，避免重复解析 Range
   */
  private parseRangeToPaths(range: Range): MarkPathItem[] {
    return this.buildPathsFromSelectionInfo(this.getSelectionInfoFromRange(range))
  }

  /**
   * 从已解析的选区节点信息构建 MarkPathItem 数组（供渲染使用）
   *
   * 相邻同 path 的文本项合并为一个条目；SLAX-MARK 标签会被穿透，
   * 使用其真实父元素的路径，与 SelectionMonitor.convertSelectionToPaths 逻辑一致
   */
  private buildPathsFromSelectionInfo(
    selectionInfo: Array<
      | { type: 'text'; node: Node; startOffset: number; endOffset: number }
      | { type: 'image'; element: HTMLImageElement }
    >
  ): MarkPathItem[] {
    const paths: MarkPathItem[] = []
    let currentPath: string | null = null
    let currentStart = 0
    let currentEnd = 0

    for (const item of selectionInfo) {
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
   * 将渲染用的 MarkPathItem[] 转换为接口入参格式 StrokeCreateSource[]
   *
   * 字段映射：path → xpath，start → start_offset，end → end_offset
   * 图片类型的偏移量固定为 0
   */
  private convertToApiSource(paths: MarkPathItem[]): StrokeCreateSource[] {
    return paths.map((p) => ({
      type: p.type,
      xpath: p.path,
      start_offset: p.start ?? 0,
      end_offset: p.end ?? 0
    }))
  }

  /**
   * 从已解析的选区节点信息构建 select_content
   *
   * 构建逻辑参考 DwebArticleSelection.handleMouseUp 对 list 的遍历：
   * - 相邻文本项合并（去除换行）
   * - 图片独立一项
   */
  private buildSelectContent(
    selectionInfo: Array<
      | { type: 'text'; node: Node; startOffset: number; endOffset: number }
      | { type: 'image'; element: HTMLImageElement }
    >
  ): StrokeCreateSelectContent[] {
    const result: StrokeCreateSelectContent[] = []

    for (const item of selectionInfo) {
      if (item.type === 'text') {
        const rawText = (item.node.textContent || '').slice(item.startOffset, item.endOffset)
        const text = rawText.replace(/\n/g, '')
        const last = result[result.length - 1]
        if (last?.type === 'text') {
          // 与 DwebArticleSelection 一致：相邻文本合并
          last.text += text
        } else {
          result.push({ type: 'text', text, src: '' })
        }
      } else if (item.type === 'image') {
        result.push({ type: 'image', text: '', src: item.element.src })
      }
    }

    return result
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
   * 从 Range 中提取 approx 信息，同时返回渲染格式和接口格式
   *
   * - approx：供 MarkItemInfo 内部使用（含 raw_text）
   * - approxCreate：供 /v1/mark/create 接口使用（含 position_start / position_end）
   *
   * position_start = 容器起点到选区起点的完整文本长度
   * position_end   = position_start + exact.length
   */
  private parseApproxFromRange(range: Range): {
    approx: MarkPathApprox
    approxCreate: StrokeCreateApproxSource
  } {
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

    const position_start = fullPrefix.length
    const position_end = position_start + exact.length

    return {
      approx: { exact, prefix, suffix, raw_text: exact },
      approxCreate: { exact, prefix, suffix, position_start, position_end }
    }
  }

  /**
   * 检查两个 source 是否相同
   */
  private checkMarkSourceIsSame(source1: MarkPathItem[], source2: MarkPathItem[]): boolean {
    return deepEqual(source1, source2)
  }

  /**
   * 从 approx 信息定位文本并返回 Range
   *
   * 使用模糊匹配算法在容器文本内容中查找 approx.exact，
   * 结合前缀/后缀上下文和位置信息进行评分排名，选择最佳匹配。
   */
  private getRangeFromApprox(approx: any): Range | null {
    if (!approx || !approx.exact) return null
    const textContent = this.container.textContent || ''
    if (!textContent) return null

    const getNodeAndOffsetAtPosition = (position: number): { node: Node; offset: number } | null => {
      const walker = document.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, null)
      let currentNode: Node | null
      let currentOffset = 0
      while ((currentNode = walker.nextNode())) {
        const nodeLength = currentNode.textContent!.length
        if (currentOffset + nodeLength > position) {
          return { node: currentNode, offset: position - currentOffset }
        }
        currentOffset += nodeLength
      }
      return null
    }

    const createRangeFromMatch = (start: number, end: number): Range | null => {
      const startInfo = getNodeAndOffsetAtPosition(start)
      const endInfo = getNodeAndOffsetAtPosition(end)
      if (!startInfo || !endInfo) return null
      const range = document.createRange()
      range.setStart(startInfo.node, startInfo.offset)
      range.setEnd(endInfo.node, endInfo.offset)
      return range
    }

    const calculateSimilarity = (str1: string, str2: string): number => {
      if (!str1 || !str2) return 0
      const maxErrors = Math.floor(Math.max(str1.length, str2.length) * 0.3)
      const longer = str1.length < str2.length ? str2 : str1
      const shorter = str1.length < str2.length ? str1 : str2
      const matches = search(longer, shorter, maxErrors)
      if (matches.length === 0) return 0
      const best = matches.reduce((b, c) => c.errors < b.errors ? c : b, matches[0])
      return 1 - best.errors / str1.length
    }

    const calculateContextScore = (start: number, end: number, expected: string): number => {
      start = Math.max(0, start)
      end = Math.min(textContent.length, end)
      if (start >= end || !expected) return 0
      const actual = textContent.substring(start, end)
      if (actual.length < expected.length * 0.5) return 0.3
      return calculateSimilarity(actual, expected)
    }

    // 策略1：精确匹配 + 上下文评分
    const fuzzyMatches = search(textContent, approx.exact, 0)
    if (fuzzyMatches.length > 0) {
      const ranked = fuzzyMatches.map(m => {
        const prefixScore = calculateContextScore(m.start - (approx.prefix || '').length, m.start, approx.prefix)
        const suffixScore = calculateContextScore(m.end, m.end + (approx.suffix || '').length, approx.suffix)
        let positionScore = 0
        if (approx.position_start != null && approx.position_end != null) {
          const distance = Math.abs((m.start + m.end) / 2 - (approx.position_start + approx.position_end) / 2)
          positionScore = 1 - Math.min(1, distance / (textContent.length / 2))
        }
        return { start: m.start, end: m.end, totalScore: prefixScore * 0.4 + suffixScore * 0.4 + positionScore * 0.2 }
      })
      const best = ranked.reduce((b, c) => c.totalScore > b.totalScore ? c : b, ranked[0])
      if (best.totalScore > 0.3) return createRangeFromMatch(best.start, best.end)
    }

    // 策略2：模糊匹配（允许 2 个字符误差）
    const quoteMatches = search(textContent, approx.exact, 2)
    if (quoteMatches.length > 0) {
      quoteMatches.sort((a, b) => {
        const aRate = a.errors / (a.end - a.start)
        const bRate = b.errors / (b.end - b.start)
        if (aRate !== bRate) return aRate - bRate
        return Math.abs(a.end - a.start - approx.exact.length) - Math.abs(b.end - b.start - approx.exact.length)
      })
      return createRangeFromMatch(quoteMatches[0].start, quoteMatches[0].end)
    }

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
