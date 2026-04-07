# Slax Reader Web Bridge

`slax-reader-web-bridge` 是一个用于 Slax Reader 客户端应用集成的 Web 桥接库。它提供了 WebView 与 Native App 之间的通信机制，以及一系列用于操作和查询 Web 内容的功能。

当前版本除原有能力外，已经集成了原 `slax-selection-bridge` 的核心能力：**文本选区监听、划线渲染、评论标记渲染、批量 Mark 管理、Mark 点击回调**。

## ✨ 功能特性

*   **Native 通信**: 提供统一的接口与 iOS 和 Android 原生层进行通信。
*   **内容管理**: 获取 Web 内容的高度，适配原生容器。
*   **图片处理**: 自动接管图片点击事件，通知原生层进行图片预览等操作。
*   **元素高亮**: 支持通过 DOM Range / Element 执行高亮。
*   **滚动控制**: 支持滚动到指定的锚点位置。
*   **搜索功能**: (内部功能) 支持在 DOM 树中查找匹配文本的元素。
*   **文本选区监听**: 支持监听用户在详情页中的文本/图片选区。
*   **Mark 渲染与管理**: 支持单个/批量绘制划线、评论标记，以及高亮、删除、查询。
*   **Mark 点击回调**: 支持点击已渲染 Mark 后通知 Native。

## 📂 项目结构

```
slax-reader-web-bridge/
├── demo/                   # 演示页面，用于测试各项功能
├── src/
│   ├── bridge/            # Native 通信核心逻辑
│   │   └── native-bridge.ts
│   ├── core/              # 核心桥接类
│   │   └── slax-webview-bridge.ts
│   ├── features/          # 具体功能实现
│   │   ├── content.ts     # 内容高度计算
│   │   ├── highlight.ts   # 元素高亮
│   │   ├── images.ts      # 图片点击处理
│   │   ├── scroll.ts      # 滚动控制
│   │   ├── search.ts      # 文本搜索
│   │   ├── selection-monitor.ts # 文本选区监听
│   │   ├── mark-renderer.ts     # 单个 mark 渲染
│   │   └── mark-manager.ts      # 批量 mark 管理
│   ├── types/             # 类型定义
│   │   └── selection.ts   # 划线与评论相关类型
│   ├── utils/             # 工具函数 (平台检测、Polyfill 等)
│   │   └── selection-utils.ts
│   └── index.ts           # 入口文件
├── tests/                 # 单元测试
├── rollup.config.js       # Rollup 打包配置
└── package.json
```

## 🚀 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发与构建

*   **启动开发模式 (监听文件变化)**:
    ```bash
    pnpm dev
    ```

*   **启动演示页面 (Demo)**:
    ```bash
    pnpm demo
    ```
    这将启动一个本地服务器，并在浏览器中打开演示页面，方便调试各项功能。

*   **构建生产版本**:
    ```bash
    pnpm build
    ```

    构建完成后，产物仍然固定为：

    ```
    dist/slax-reader-web-bridge.js
    ```

*   **运行测试**:
    ```bash
    pnpm test
    ```

## 📖 使用指南

### 初始化

在 Web 页面中引入打包后的脚本后，Bridge 会自动实例化到全局：

```typescript
window.SlaxWebViewBridge
```

如果是模块方式使用，也可以手动实例化：

```typescript
import { SlaxWebViewBridge } from 'slax-reader-web-bridge';

const bridge = new SlaxWebViewBridge();
```

初始化时，Bridge 会自动：
1. 应用必要的 Polyfills。
2. 绑定图片点击事件监听器。
3. 绑定 bookmark notfound 相关监听。
4. 向 Native 发送 `domReady` 消息。

### Selection / Mark 功能接入

由于 `SlaxWebViewBridge` 是自动实例化的，selection 能力采用**延迟初始化**方式接入：

```typescript
window.SlaxWebViewBridge.startSelectionMonitoring('#content', currentUserId)
```

其中：
- `#content` 是详情页正文容器的 CSS 选择器
- `currentUserId` 可选，用于区分“自己的划线”

停止监听：

```typescript
window.SlaxWebViewBridge.stopSelectionMonitoring()
```

清除当前选区：

```typescript
window.SlaxWebViewBridge.clearSelection()
```

### API 参考

#### 1. 发送消息给 Native (`postMessage`)

```typescript
bridge.postMessage({
    type: 'some-action',
    payload: { /* data */ }
});
```

*   **Android**: 调用 `window.NativeBridge.postMessage`
*   **iOS**: 调用 `window.webkit.messageHandlers.NativeBridge.postMessage`

#### 2. 获取内容高度 (`getContentHeight`)

```typescript
const height = bridge.getContentHeight();
```

#### 3. 滚动到锚点 (`scrollToAnchor`)

```typescript
bridge.scrollToAnchor('section-1');
```

#### 4. 高亮元素 (`highlightElement`)

```typescript
bridge.highlightElement(target);
```

#### 5. 开始监听选区 (`startSelectionMonitoring`)

```typescript
bridge.startSelectionMonitoring('#content', 1001);
```

#### 6. 停止监听选区 (`stopSelectionMonitoring`)

```typescript
bridge.stopSelectionMonitoring();
```

#### 7. 绘制单个 Mark (`drawMark`)

注意：`paths` 参数现在使用 **JSON 字符串**。

```typescript
const markId = bridge.drawMark(
  null,
  JSON.stringify([
    { type: 'text', path: 'p:nth-child(1)', start: 0, end: 10 }
  ]),
  true,
  false,
  1001
);
```

#### 8. 更新 Mark (`updateMark`)

```typescript
bridge.updateMark(markId, true, true, 1001);
```

#### 9. 删除 Mark (`removeMark`)

```typescript
bridge.removeMark(markId);
```

#### 10. 高亮 Mark (`highlightMark`)

```typescript
bridge.highlightMark(markId);
```

#### 11. 清除所有高亮 (`clearHighlights`)

```typescript
bridge.clearHighlights();
```

#### 12. 清除所有 Mark (`clearAllMarks`)

```typescript
bridge.clearAllMarks();
```

#### 13. 获取所有 Mark ID (`getAllMarkIds`)

```typescript
const ids = bridge.getAllMarkIds();
```

#### 14. 批量绘制 Mark (`drawMarks`)

```typescript
const result = bridge.drawMarks(JSON.stringify(markDetail));
```

返回值格式：

```typescript
{
  [uuid: string]: BackendMarkInfo[]
}
```

#### 15. 根据 UUID 删除 Mark (`removeMarkByUuid`)

```typescript
bridge.removeMarkByUuid(uuid);
```

#### 16. 更新当前用户 (`setCurrentUserId`)

```typescript
bridge.setCurrentUserId(1002);
```

## 🔁 Native 消息协议

### Web -> Native

除既有消息外，新增以下消息类型：

#### `textSelected`
用户完成文本/图片选区后触发。

```typescript
{
  type: 'textSelected',
  data: string,      // JSON 字符串，包含 selection / paths / approx
  position: string   // JSON 字符串，包含位置信息
}
```

#### `markClicked`
用户点击 `slax-mark` 后触发。

```typescript
{
  type: 'markClicked',
  markId: string,
  data: string,      // JSON 字符串，包含 id / text / classList
  position: string   // JSON 字符串，包含位置信息
}
```

#### `markRendered`
单个 mark 渲染完成后触发。

```typescript
{
  type: 'markRendered',
  markId: string,
  success: boolean
}
```

#### `selectionError`
selection / mark 相关逻辑执行失败时触发。

```typescript
{
  type: 'selectionError',
  error: string
}
```

## 🔧 Native 适配说明

为了确保 Bridge 正常工作，Native 端需要注入相应的 JavaScript 接口：

*   **Android**: 需要在 WebView 中注入名为 `NativeBridge` 的对象。
*   **iOS**: 需要在 `WKWebView` 的 `userContentController` 中注册名为 `NativeBridge` 的 ScriptMessageHandler。

如果你此前接入的是旧的 `slax-selection-bridge`，需要注意：

1. 不再使用 `window.SlaxBridge.onTextSelected(...)` 这类直接方法调用。
2. selection / mark 相关回调已经统一改为 `NativeBridge.postMessage({ type: ... })` 消息协议。
3. `drawMark` 的 `paths` 参数改为 JSON 字符串。
4. CSS 需要由 App 自行注入（本库不负责注入样式）。

## 📄 License

MIT
