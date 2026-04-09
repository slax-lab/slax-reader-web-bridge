/**
 * 标记路径项（文本或图片）
 */
export interface MarkPathItem {
  /** 类型：文本或图片 */
  type: 'text' | 'image'
  /** CSS选择器路径 */
  path: string
  /** 起始偏移（文本类型） */
  start?: number
  /** 结束偏移（文本类型） */
  end?: number
}

/**
 * 近似匹配信息（用于兼容性）
 */
export interface MarkPathApprox {
  /** 精确文本 */
  exact: string
  /** 前缀文本 */
  prefix: string
  /** 后缀文本 */
  suffix: string
  /** 原始文本（含换行） */
  raw_text?: string
}

/**
 * 选择的文本信息
 */
export type SelectTextInfo =
  | {
      type: 'text'
      /** 起始偏移 */
      startOffset: number
      /** 结束偏移 */
      endOffset: number
      /** 文本内容 */
      text: string
      /** 文本节点 */
      node: Node
    }
  | {
      type: 'image'
      /** 图片源 */
      src: string
      /** 图片元素 */
      element: HTMLImageElement
    }

/**
 * 绘制标记的基础信息
 */
export interface DrawMarkInfo {
  /** 标记ID */
  id: string
  /** 是否为划线 */
  isStroke: boolean
  /** 是否有评论 */
  hasComment: boolean
  /** 是否为当前用户的划线 */
  isSelfStroke: boolean
  /** 是否高亮显示 */
  isHighlighted?: boolean
}

/**
 * 选择事件数据
 */
export interface SelectionEventData {
  /** 选择的文本/图片信息 */
  selection: SelectTextInfo[]
  /** 标记路径 */
  paths: MarkPathItem[]
  /** 近似匹配信息 */
  approx?: MarkPathApprox
  /** 位置信息（用于显示菜单） */
  position: PositionInfo
}

/**
 * 位置信息（用于显示菜单）
 */
export interface PositionInfo {
  /** X 坐标 */
  x: number
  /** Y 坐标 */
  y: number
  /** 宽度（可选） */
  width?: number
  /** 高度（可选） */
  height?: number
  /** 上边距（可选） */
  top?: number
  /** 左边距（可选） */
  left?: number
  /** 右边距（可选） */
  right?: number
  /** 下边距（可选） */
  bottom?: number
}

/**
 * 后端标记类型
 */
export enum BackendMarkType {
  /** 划线 */
  LINE = 1,
  /** 评论 */
  COMMENT = 2,
  /** 回复 */
  REPLY = 3,
  /** 原始划线（兼容旧版本） */
  ORIGIN_LINE = 4,
  /** 原始评论（兼容旧版本） */
  ORIGIN_COMMENT = 5
}

/**
 * 用户信息
 */
export interface MarkUserInfo {
  /** 用户ID */
  user_id: number
  /** 用户名 */
  username: string
  /** 头像 */
  avatar: string
}

/**
 * 用户列表（键为用户ID字符串）
 */
export type UserList = {
  [key: string]: MarkUserInfo
}

/**
 * 后端返回的标记信息
 */
export interface BackendMarkInfo {
  /** 标记ID */
  id: number
  /** 用户ID */
  user_id: number
  /** 标记类型 */
  type: BackendMarkType
  /** 标记源（路径或数字） */
  source: MarkPathItem[] | number
  /** 近似匹配信息 */
  approx_source?: MarkPathApprox
  /** 父评论ID */
  parent_id: number
  /** 根评论ID */
  root_id: number
  /** 评论内容 */
  comment: string
  /** 创建时间 */
  created_at: Date | string
  /** 是否已删除 */
  is_deleted: boolean
  /** 子评论列表 */
  children?: BackendMarkInfo[]
}

/**
 * 标记详情（后端返回）
 */
export interface MarkDetail {
  /** 标记列表 */
  mark_list: BackendMarkInfo[]
  /** 用户列表 */
  user_list: UserList
}

/**
 * 评论信息（UI层）
 */
export interface MarkCommentInfo {
  /** 标记ID */
  markId: number
  /** 评论内容 */
  comment: string
  /** 用户ID */
  userId: number
  /** 用户名 */
  username: string
  /** 头像 */
  avatar: string
  /** 是否已删除 */
  isDeleted: boolean
  /** 子评论列表 */
  children: MarkCommentInfo[]
  /** 创建时间 */
  createdAt: Date
  /** 根评论ID */
  rootId?: number
  /** 回复目标 */
  reply?: {
    id: number
    username: string
    userId: number
    avatar: string
  }
  /** 是否显示输入框（UI状态） */
  showInput?: boolean
  /** 加载状态（UI状态） */
  loading?: boolean
  /** 操作加载状态（UI状态） */
  operateLoading?: boolean
}

/**
 * 标记项信息（分组后的标记）
 */
export interface MarkItemInfo {
  /** 本地生成的UUID */
  id: string
  /** 标记路径源 */
  source: MarkPathItem[]
  /** 划线信息列表 */
  stroke: { mark_id?: number; userId: number }[]
  /** 评论信息列表 */
  comments: MarkCommentInfo[]
  /** 近似匹配信息 */
  approx?: MarkPathApprox
}

/**
 * drawMarks 返回值（uuid -> 该uuid对应的后端mark列表）
 */
export type DrawMarksResult = {
  [uuid: string]: BackendMarkInfo[]
}

// ==================== strokeCurrentSelection 返回类型 ====================

/**
 * 划线接口（/v1/mark/create）的 source 字段格式
 */
export interface StrokeCreateSource {
  type: 'text' | 'image'
  /** CSS 选择器路径，对应接口字段 xpath */
  xpath: string
  /** 文本起始偏移（图片类型为 0） */
  start_offset: number
  /** 文本结束偏移（图片类型为 0） */
  end_offset: number
}

/**
 * 划线接口（/v1/mark/create）的 select_content 字段格式
 *
 * 构建逻辑参考 DwebArticleSelection.handleMouseUp 中对 list 的遍历：
 * 相邻文本节点合并，图片独立一项
 */
export interface StrokeCreateSelectContent {
  type: 'text' | 'image'
  /** 文本内容（图片类型为空字符串） */
  text: string
  /** 图片 src（文本类型为空字符串） */
  src: string
}

/**
 * 划线接口（/v1/mark/create）的 approx_source 字段格式
 */
export interface StrokeCreateApproxSource {
  /** 选中的精确文本 */
  exact: string
  /** 选区前最多 50 个字符 */
  prefix: string
  /** 选区后最多 50 个字符 */
  suffix: string
  /** 选区起始字符位置（从容器文本起点计算） */
  position_start: number
  /** 选区结束字符位置（= position_start + exact.length） */
  position_end: number
}

/**
 * strokeCurrentSelection 的完整返回值
 *
 * 包含本地渲染所需的 uuid 以及调用 /v1/mark/create 接口所需的全部字段
 */
export interface StrokeCreateData {
  /** 本地生成的 UUID，用于后续通过 updateMarkIdByUuid 关联后端 mark_id */
  uuid: string
  /** 后端接口 source 字段 */
  source: StrokeCreateSource[]
  /** 后端接口 select_content 字段 */
  select_content: StrokeCreateSelectContent[]
  /** 后端接口 approx_source 字段（可选） */
  approx_source?: StrokeCreateApproxSource
}
