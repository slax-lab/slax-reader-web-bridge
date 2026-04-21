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

  /** 当前选中区域对应的 MarkItemInfo（选区存在时有值，取消选区后为 null） */
  private _currentMarkItemInfo: MarkItemInfo | null = null

  /** 选区对应的 MarkItemInfo 变化时的回调（仅在选中时触发，取消选区不触发） */
  private onSelectionMarkInfoChange?: (markItemInfo: MarkItemInfo) => void

  /** 获取当前选中区域对应的 MarkItemInfo */
  get currentMarkItemInfo(): MarkItemInfo | null {
    return this._currentMarkItemInfo
  }

  constructor(
    container: HTMLElement,
    currentUserId?: number,
    onMarkTap?: (markId: string, event: TouchEvent) => void,
    onSelectionMarkInfoChange?: (markItemInfo: MarkItemInfo) => void
  ) {
    this.container = container
    this.renderer = new MarkRenderer(container, currentUserId, onMarkTap)
    this.onSelectionMarkInfoChange = onSelectionMarkInfoChange
  }

  /**
   * 根据当前选区检测对应的 MarkItemInfo
   *
   * 解析选区的 paths，如果与已有的 MarkItemInfo 的 source 完全匹配，
   * 则返回该 MarkItemInfo；否则创建一个临时包装的 MarkItemInfo。
   * 同时更新 currentMarkItemInfo 并触发回调。
   *
   * @param paths 当前选区解析出的 MarkPathItem 数组
   * @param approx 当前选区的近似匹配信息
   */
  detectSelectionMarkItemInfo(paths: MarkPathItem[], approx?: MarkPathApprox): void {
    if (paths.length === 0) return

    // 选区未变化时跳过，避免 selectionchange 事件重复触发导致回调被反复调用
    if (this._currentMarkItemInfo && this.checkMarkSourceIsSame(this._currentMarkItemInfo.source, paths)) {
      return
    }

    const existing = this.markItemInfos.find((info) =>
      this.checkMarkSourceIsSame(info.source, paths)
    )

    const markItemInfo: MarkItemInfo = existing ?? {
      id: '',
      source: paths,
      comments: [],
      stroke: [],
      approx
    }

    this._currentMarkItemInfo = markItemInfo
    this.onSelectionMarkInfoChange?.(markItemInfo)
  }

  /**
   * 清除当前选区对应的 MarkItemInfo（取消选区时调用，不触发回调）
   */
  clearCurrentMarkItemInfo(): void {
    this._currentMarkItemInfo = null
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
   * 根据本地 UUID 获取 MarkItemInfo
   */
  getMarkItemInfoByUuid(uuid: string): MarkItemInfo | null {
    return this.markItemInfos.find((info) => info.id === uuid) ?? null
  }

  /**
   * 清除所有标记
   */
  clearAllMarks(): void {
    this.renderer.clearAllMarks()
    this.markItemInfos = []
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
    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] addStrokeByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      return false
    }

    const alreadyStroked = infoItem.stroke.some((s) => s.userId === userId)
    if (alreadyStroked) {
      console.log('[MarkManager] addStrokeByUuid 用户已有划线，跳过，uuid:', uuid, 'userId:', userId)
      return false
    }

    infoItem.stroke.push({ mark_id: undefined, userId })
    this.updateMarkItemUI(infoItem)
    console.log('[MarkManager] addStrokeByUuid 成功，uuid:', uuid, 'userId:', userId)
    return true
  }

  /**
   * 通过 source 添加划线（用于临时选区场景）
   *
   * 当 markItemInfo 是临时的（id 为空、未被 markItemInfos 持有）时使用此方法。
   * 流程为：
   * 1. 根据 source 检查 markItemInfos 中是否已有匹配项
   * 2. 若没有则创建新的 MarkItemInfo 并 push 到 markItemInfos
   * 3. 在对应 MarkItemInfo 中插入划线记录
   * 4. 渲染 DOM 样式
   * 5. 返回 uuid 和接口所需的 source/select_content/approx_source 数据
   *
   * @param source MarkPathItem 数组（从临时 markItemInfo 中获取）
   * @param userId 执行划线的用户ID
   * @param approx 近似位置信息（可选，为空时自动从 source 生成）
   * @returns 包含 uuid 及接口入参的数据，失败返回 null
   */
  addStrokeBySource(
    source: MarkPathItem[],
    userId: number,
    approx?: MarkPathApprox
  ): StrokeCreateData | null {
    if (!source || source.length === 0) {
      console.warn('[MarkManager] addStrokeBySource 终止：source 为空')
      return null
    }

    // 若 approx 为空，根据 source 定位 DOM 元素重新生成
    let resolvedApprox = approx
    if (!resolvedApprox) {
      resolvedApprox = this.buildApproxFromSource(source)
      if (resolvedApprox) {
        console.log('[MarkManager] addStrokeBySource 根据 source 生成了 approx:', resolvedApprox)
      }
    }

    // 1. 检查是否已有匹配的 MarkItemInfo
    let infoItem = this.markItemInfos.find((info) =>
      this.checkMarkSourceIsSame(info.source, source)
    )

    // 2. 没有则创建新的
    if (!infoItem) {
      const uuid = generateUUID()
      infoItem = {
        id: uuid,
        source,
        stroke: [],
        comments: [],
        approx: resolvedApprox
      }
      this.markItemInfos.push(infoItem)
      console.log('[MarkManager] addStrokeBySource 创建新 MarkItemInfo，uuid:', uuid)
    } else {
      console.log('[MarkManager] addStrokeBySource 命中已有 MarkItemInfo，uuid:', infoItem.id)
    }

    // 3. 幂等检查后插入划线记录
    const alreadyStroked = infoItem.stroke.some((s) => s.userId === userId)
    if (!alreadyStroked) {
      infoItem.stroke.push({ mark_id: undefined, userId })
    }

    // 4. 渲染 DOM
    this.drawSingleMarkItem(infoItem)

    // 5. 构造返回数据
    const apiSource = this.convertToApiSource(source)
    const selectContent: StrokeCreateSelectContent[] = resolvedApprox?.raw_text
      ? [{ type: 'text' as const, text: resolvedApprox.raw_text, src: '' }]
      : [{ type: 'text' as const, text: resolvedApprox?.exact ?? '', src: '' }]

    const result: StrokeCreateData = {
      uuid: infoItem.id,
      source: apiSource,
      select_content: selectContent,
      approx_source: resolvedApprox ? {
        exact: resolvedApprox.exact,
        prefix: resolvedApprox.prefix,
        suffix: resolvedApprox.suffix,
        position_start: 0,
        position_end: resolvedApprox.exact.length
      } : undefined
    }

    console.log('[MarkManager] addStrokeBySource 完成，返回:', result)
    return result
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
    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] removeStrokeByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      return false
    }

    const strokeIndex = infoItem.stroke.findIndex((s) => s.userId === userId)
    if (strokeIndex === -1) {
      console.log('[MarkManager] removeStrokeByUuid 该用户无划线，跳过，uuid:', uuid, 'userId:', userId)
      return false
    }

    infoItem.stroke.splice(strokeIndex, 1)

    // 划线和评论都为空时，整体删除该标记
    if (infoItem.stroke.length === 0 && infoItem.comments.length === 0) {
      this.removeMarkByUuid(uuid)
      console.log('[MarkManager] removeStrokeByUuid 标记已无划线和评论，整体删除，uuid:', uuid)
    } else {
      this.updateMarkItemUI(infoItem)
      console.log('[MarkManager] removeStrokeByUuid 成功，uuid:', uuid, 'userId:', userId)
    }

    return true
  }

  /**
   * 根据 UUID 添加评论
   *
   * 在对应 MarkItemInfo 的 comments 数组中追加一条评论记录，并重新渲染 DOM 样式。
   *
   * @param uuid MarkItemInfo 的本地 UUID
   * @param params 评论参数对象
   * @param params.userId 发表评论的用户ID
   * @param params.comment 评论内容
   * @param params.username 用户名（用于即时展示）
   * @param params.avatar 用户头像URL（用于即时展示）
   * @returns 是否成功添加（false 表示 uuid 不存在）
   */
  addCommentByUuid(uuid: string, params: { userId: number; comment: string; username?: string; avatar?: string }): boolean {
    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] addCommentByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      return false
    }

    const commentInfo: MarkCommentInfo = {
      markId: 0,
      comment: params.comment,
      userId: params.userId,
      username: params.username ?? '',
      avatar: params.avatar ?? '',
      isDeleted: false,
      children: [],
      createdAt: new Date(),
      showInput: false,
      loading: false,
      operateLoading: false
    }

    infoItem.comments.push(commentInfo)
    this.updateMarkItemUI(infoItem)
    console.log('[MarkManager] addCommentByUuid 成功，uuid:', uuid, 'userId:', params.userId)
    return true
  }

  /**
   * 通过 source 添加评论（用于临时选区场景）
   *
   * 当 markItemInfo 是临时的（id 为空、未被 markItemInfos 持有）时使用此方法。
   * 流程为：
   * 1. 根据 source 检查 markItemInfos 中是否已有匹配项
   * 2. 若没有则创建新的 MarkItemInfo 并 push 到 markItemInfos
   * 3. 在对应 MarkItemInfo 中插入评论记录
   * 4. 渲染 DOM 样式
   * 5. 返回 uuid 和接口所需的 source/select_content/approx_source 数据
   *
   * @param source MarkPathItem 数组（从临时 markItemInfo 中获取）
   * @param commentParams 评论参数
   * @param approx 近似位置信息（可选，从临时 markItemInfo 中获取）
   * @returns 包含 uuid 及接口入参的数据，失败返回 null
   */
  addCommentBySource(
    source: MarkPathItem[],
    commentParams: { userId: number; comment: string; username?: string; avatar?: string },
    approx?: MarkPathApprox
  ): StrokeCreateData | null {
    if (!source || source.length === 0) {
      console.warn('[MarkManager] addCommentBySource 终止：source 为空')
      return null
    }

    // 若 approx 为空，根据 source 定位 DOM 元素重新生成
    let resolvedApprox = approx
    if (!resolvedApprox) {
      resolvedApprox = this.buildApproxFromSource(source)
      if (resolvedApprox) {
        console.log('[MarkManager] addCommentBySource 根据 source 生成了 approx:', resolvedApprox)
      }
    }

    // 1. 检查是否已有匹配的 MarkItemInfo
    let infoItem = this.markItemInfos.find((info) =>
      this.checkMarkSourceIsSame(info.source, source)
    )

    // 2. 没有则创建新的
    if (!infoItem) {
      const uuid = generateUUID()
      infoItem = {
        id: uuid,
        source,
        stroke: [],
        comments: [],
        approx: resolvedApprox
      }
      this.markItemInfos.push(infoItem)
      console.log('[MarkManager] addCommentBySource 创建新 MarkItemInfo，uuid:', uuid)
    } else {
      console.log('[MarkManager] addCommentBySource 命中已有 MarkItemInfo，uuid:', infoItem.id)
    }

    // 3. 插入评论记录
    const commentInfo: MarkCommentInfo = {
      markId: 0,
      comment: commentParams.comment,
      userId: commentParams.userId,
      username: commentParams.username ?? '',
      avatar: commentParams.avatar ?? '',
      isDeleted: false,
      children: [],
      createdAt: new Date(),
      showInput: false,
      loading: false,
      operateLoading: false
    }
    infoItem.comments.push(commentInfo)

    // 4. 渲染 DOM
    this.drawSingleMarkItem(infoItem)

    // 5. 构造返回数据
    const apiSource = this.convertToApiSource(source)
    const selectContent: StrokeCreateSelectContent[] = resolvedApprox?.raw_text
      ? [{ type: 'text' as const, text: resolvedApprox.raw_text, src: '' }]
      : [{ type: 'text' as const, text: resolvedApprox?.exact ?? '', src: '' }]

    const result: StrokeCreateData = {
      uuid: infoItem.id,
      source: apiSource,
      select_content: selectContent,
      approx_source: resolvedApprox ? {
        exact: resolvedApprox.exact,
        prefix: resolvedApprox.prefix,
        suffix: resolvedApprox.suffix,
        position_start: 0,
        position_end: resolvedApprox.exact.length
      } : undefined
    }

    console.log('[MarkManager] addCommentBySource 完成，返回:', result)
    return result
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
        existing.stroke.push({ mark_id: undefined, userId: userId ?? 0 })
        this.drawSingleMarkItem(existing)
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

    this.markItemInfos.push(infoItem)
    this.drawSingleMarkItem(infoItem)

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
   * 通过 uuid 找到对应的 MarkItemInfo，并将其 stroke 中 mark_id 为空的项更新为指定 mark_id
   *
   * 用于在后端 API 返回 mark_id 后，将本地临时记录与后端数据关联
   *
   * @param uuid MarkItemInfo 的 uuid（由 strokeCurrentSelection 返回）
   * @param markId 后端返回的 mark_id
   * @param userId 用户ID（用于精确匹配对应 stroke 条目，可选）
   */
  updateMarkIdByUuid(uuid: string, markId: number, userId?: number): void {
    console.log('[MarkManager] updateMarkIdByUuid 开始，uuid:', uuid, 'markId:', markId, 'userId:', userId)
    console.log('[MarkManager] updateMarkIdByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)))

    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] updateMarkIdByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      return
    }

    console.log('[MarkManager] updateMarkIdByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)))
    console.log('[MarkManager] updateMarkIdByUuid 当前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)))

    const stroke = infoItem.stroke.find((s) => !s.mark_id && (userId === undefined || s.userId === userId))
    if (stroke) {
      console.log('[MarkManager] updateMarkIdByUuid 找到匹配 stroke，更新前:', JSON.parse(JSON.stringify(stroke)))
      stroke.mark_id = markId
      console.log('[MarkManager] updateMarkIdByUuid 更新后 stroke:', JSON.parse(JSON.stringify(stroke)))
    } else {
      console.warn('[MarkManager] updateMarkIdByUuid 未找到可更新的 stroke（mark_id 为空且 userId 匹配）', 'userId 过滤条件:', userId)
    }

    console.log('[MarkManager] updateMarkIdByUuid 完成，最新 markItemInfos:', JSON.parse(JSON.stringify(this.markItemInfos)))
  }

  /**
   * 通过 uuid 将后端返回的 mark_id 回补到评论记录
   *
   * 找到指定 uuid 的 MarkItemInfo，将 comments 中最后一条 markId === 0 的临时评论
   * 更新为后端返回的真实 markId，确保后续删除/更新操作能正确关联后端数据。
   *
   * @param uuid MarkItemInfo 的本地 UUID
   * @param markId 后端返回的 mark_id
   * @returns 是否成功更新
   */
  updateCommentMarkIdByUuid(uuid: string, markId: number): boolean {
    const infoItem = this.markItemInfos.find((info) => info.id === uuid)
    if (!infoItem) {
      console.warn('[MarkManager] updateCommentMarkIdByUuid 未找到对应的 MarkItemInfo，uuid:', uuid)
      return false
    }

    // 从后往前找第一条 markId 为 0 的临时评论（即最近一次 addCommentByUuid 添加的）
    for (let i = infoItem.comments.length - 1; i >= 0; i--) {
      if (infoItem.comments[i].markId === 0) {
        infoItem.comments[i].markId = markId
        console.log('[MarkManager] updateCommentMarkIdByUuid 成功，uuid:', uuid, 'markId:', markId)
        return true
      }
    }

    console.warn('[MarkManager] updateCommentMarkIdByUuid 未找到 markId 为 0 的临时评论，uuid:', uuid)
    return false
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
   * 根据 source（MarkPathItem[]）构建 Range 并复用 parseApproxFromRange 生成 MarkPathApprox
   *
   * @param source MarkPathItem 数组
   * @returns 生成的 MarkPathApprox，若 DOM 元素不存在则返回 undefined
   */
  private buildApproxFromSource(source: MarkPathItem[]): MarkPathApprox | undefined {
    const range = this.buildRangeFromSource(source)
    if (!range) return undefined

    try {
      const { approx } = this.parseApproxFromRange(range)
      return approx
    } catch (error) {
      console.warn('[MarkManager] buildApproxFromSource parseApproxFromRange 失败:', error)
      return undefined
    }
  }

  /**
   * 根据 source（MarkPathItem[]）定位 DOM 元素，构建一个覆盖整个选区的 Range
   *
   * @param source MarkPathItem 数组
   * @returns 构建的 Range，若 DOM 元素不存在则返回 null
   */
  private buildRangeFromSource(source: MarkPathItem[]): Range | null {
    // 只处理文本类型的 source
    const textSources = source.filter((s) => s.type === 'text')
    if (textSources.length === 0) return null

    const first = textSources[0]
    const last = textSources[textSources.length - 1]

    const firstElement = this.container.querySelector(first.path) as HTMLElement
    const lastElement = this.container.querySelector(last.path) as HTMLElement
    if (!firstElement || !lastElement) return null

    // 在第一个元素中定位起始文本节点和偏移
    const startResult = this.findTextNodeAtOffset(firstElement, first.start ?? 0)
    // 在最后一个元素中定位结束文本节点和偏移
    const endResult = this.findTextNodeAtOffset(lastElement, last.end ?? 0)
    if (!startResult || !endResult) return null

    try {
      const range = document.createRange()
      range.setStart(startResult.node, startResult.offset)
      range.setEnd(endResult.node, endResult.offset)
      return range
    } catch (error) {
      console.warn('[MarkManager] buildRangeFromSource Range 构建失败:', error)
      return null
    }
  }

  /**
   * 在元素的文本节点中定位指定字符偏移所对应的 { node, offset }
   */
  private findTextNodeAtOffset(element: HTMLElement, targetOffset: number): { node: Node; offset: number } | null {
    const textNodes = getAllTextNodes(element)
    let accumulated = 0

    for (const node of textNodes) {
      const nodeLen = (node.textContent || '').length
      if (accumulated + nodeLen >= targetOffset) {
        return { node, offset: targetOffset - accumulated }
      }
      accumulated += nodeLen
    }

    // 偏移超出范围，定位到最后一个文本节点末尾
    if (textNodes.length > 0) {
      const lastNode = textNodes[textNodes.length - 1]
      return { node: lastNode, offset: (lastNode.textContent || '').length }
    }

    return null
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
