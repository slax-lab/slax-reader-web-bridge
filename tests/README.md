# 单元测试文档

本项目使用 [Jest](https://jestjs.io/) 作为测试框架，配合 [ts-jest](https://kulshekhar.github.io/ts-jest/) 直接运行 TypeScript 测试代码。测试环境配置为 `jsdom`，用于在 Node.js 环境中模拟浏览器 DOM API。

## 运行测试

```bash
# 运行所有测试
npm test

# 监听模式（开发时使用）
npm test -- --watch
```

## 目录结构

```
tests/
├── setup.ts                         # 全局测试配置和 Mock 初始化
├── bridge.test.ts                   # 基础 Bridge 通信测试
├── slax-webview-bridge.test.ts      # 主类初始化与 selection 集成测试
└── features/                        # 各个功能模块的测试
    ├── content.test.ts              # 内容高度计算
    ├── highlight.test.ts            # 文本高亮
    ├── images.test.ts               # 图片点击处理
    ├── scroll.test.ts               # 滚动定位
    ├── search.test.ts               # 搜索与模糊匹配
    ├── selection-monitor.test.ts    # 文本选区监听
    ├── mark-renderer.test.ts        # 单个 mark 渲染
    └── mark-manager.test.ts         # 批量 mark 管理
```

## 测试详情

### 1. 全局配置 (`setup.ts`)
- **Mock DOM API**: 模拟了 JSDOM 不支持或行为不一致的 API，如 `Element.prototype.scrollIntoView` 和 `window.scrollTo`。
- **Mock Native Bridge**: 在 `window` 对象上挂载了模拟的 `NativeBridge` (Android) 和 `webkit.messageHandlers.NativeBridge` (iOS) 对象，用于验证消息发送。
- **Console**: 拦截了 `console.warn` 和 `console.error` 以保持测试输出整洁，同时便于断言错误日志。

### 2. 基础通信 (`bridge.test.ts`)
- **目标**: 验证 `postToNativeBridge` 函数能否正确识别平台并发送消息。
- **覆盖场景**:
  - Android 平台消息发送 (`window.NativeBridge.postMessage`)。
  - iOS 平台消息发送 (`window.webkit.messageHandlers.NativeBridge.postMessage`)。
  - 未知平台或 Bridge 未注入时的错误处理。

### 3. 主类初始化与集成 (`slax-webview-bridge.test.ts`)
- **目标**: 验证 `SlaxWebViewBridge` 类的实例化过程，以及 selection / mark 能力的桥接集成。
- **覆盖场景**:
  - 验证 Polyfill 和图片点击监听器是否被调用。
  - 验证核心方法 (`postMessage`, `getContentHeight` 等) 是否正确暴露。
  - **生命周期**: 验证当 `document.readyState` 为 `loading` 时，是否正确等待 `DOMContentLoaded` 事件触发后再初始化。
  - **Selection 集成**: 验证 `startSelectionMonitoring`, `stopSelectionMonitoring`, `drawMark`, `drawMarks`, `removeMark`, `setCurrentUserId` 等方法的基础行为。
  - **Native 消息**: 验证 `markRendered`, `markClicked` 等消息是否通过统一 `postToNativeBridge` 协议发送。

### 4. 功能模块测试 (`features/`)

#### 内容高度 (`content.test.ts`)
- **测试点**: `getContentHeight`
- **逻辑**: 验证是否能从 `body` 和 `documentElement` 的 `scrollHeight`, `offsetHeight`, `clientHeight` 中取最大值作为页面高度。

#### 文本高亮 (`highlight.test.ts`)
- **测试点**: `highlightElement`
- **逻辑**:
  - 验证是否调用 `window.getSelection` 和 `Range` API 选中指定元素。
  - 验证空元素输入的容错处理。
  - 验证定时器逻辑：高亮是否在指定时间后自动取消（使用 Jest Fake Timers）。

#### 图片处理 (`images.test.ts`)
- **测试点**: `initImageClickHandlers`
- **逻辑**:
  - 模拟 DOM 中的图片元素。
  - 触发 `click` 事件，验证是否向 Native 发送了正确的 `imageClick` 消息。
  - 验证消息载荷：包含当前图片 URL、所有图片 URL 列表以及当前索引。
  - 验证过滤逻辑：确保非 HTTP/HTTPS 图片（如 Base64）被正确忽略。

#### 滚动定位 (`scroll.test.ts`)
- **测试点**: `scrollToElement`, `scrollToAnchor`
- **逻辑**:
  - **Android**: 验证是否计算了元素位置百分比并通过 Bridge 发送 `scrollToPosition` 消息。
  - **iOS**: 验证是否调用了原生 `scrollIntoView` 方法。
  - **锚点查找**: 结合搜索模块，验证通过锚点文本查找元素并触发滚动的流程。

#### 搜索算法 (`search.test.ts`)
- **测试点**: `findMatchingElement`, `findAllMatchingElements`, `findBestFuzzyMatch`
- **逻辑**:
  - **精确查找**: 验证 ID 查找 > Name 属性查找 > 文本内容查找的优先级。
  - **遍历逻辑**: 验证递归 DOM 遍历能否正确找到包含特定文本的元素。
  - **可见性过滤**: 验证 `display: none` 或尺寸为 0 的隐藏元素是否被忽略。
  - **模糊匹配**: 验证当精确匹配失败时，是否能通过 Levenshtein 距离算法找到最接近的文本节点（容错匹配）。

#### 文本选区监听 (`selection-monitor.test.ts`)
- **测试点**: `SelectionMonitor`
- **逻辑**:
  - 验证 `start` / `stop` / `clearSelection` 的基础行为。
  - 验证 `selectionchange` 防抖逻辑（300ms 内多次变化只回调一次）。
  - 验证 collapsed selection 和容器外 selection 会被忽略。
  - 验证回调数据中包含 `selection`, `paths`, `approx`, `position` 字段。

#### 单个 Mark 渲染 (`mark-renderer.test.ts`)
- **测试点**: `MarkRenderer`
- **逻辑**:
  - 验证文本 mark 是否正确包裹为 `slax-mark`。
  - 验证 `stroke`, `comment`, `self-stroke`, `highlighted` 等 class 行为。
  - 验证 `updateMark`, `removeMark`, `highlightMark`, `clearAllHighlights`, `clearAllMarks`, `getAllMarkIds` 的行为。

#### 批量 Mark 管理 (`mark-manager.test.ts`)
- **测试点**: `MarkManager`
- **逻辑**:
  - 验证 `drawMarks` 能正确处理 `MarkDetail` 数据。
  - 验证相同 `source` 的 `LINE` / `COMMENT` 会被合并到同一 uuid。
  - 验证 `REPLY` 不会单独生成 uuid。
  - 验证 `removeMarkByUuid`, `clearAllMarks`, `getAllMarkIds` 等行为。

## 编写新测试

如果您添加了新的 Feature，请遵循以下步骤：
1. 在 `tests/features/` 下创建对应的 `.test.ts` 文件。
2. 使用 `describe` 和 `test` 描述测试用例。
3. 如果需要模拟 Native 交互，请 spy `src/bridge/native-bridge.ts` 中的 `postToNativeBridge` 或直接检查 `window.NativeBridge` 的 mock 调用。
4. 如果新功能依赖 DOM 结构，请尽量在单测中直接构造最小 DOM，而不是依赖 demo 页面。
5. 运行 `npm test` 确保测试通过。
