/**
 * 生成UUID
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * 获取Range中的所有文本节点
 */
export function getTextNodesInRange(range: Range): Text[] {
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (range.intersectsNode(node)) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_REJECT
      }
    }
  )

  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text)
    }
  }

  return textNodes
}

/**
 * 移除外层标签，保留内容
 */
export function removeOuterTag(element: Element): void {
  const parent = element.parentNode
  if (!parent) return

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

/**
 * 获取元素的CSS选择器路径
 */
export function getElementPath(element: Element, container: HTMLElement): string {
  const path: string[] = []
  let current: Element | null = element

  while (current && current !== container) {
    let selector = current.tagName.toLowerCase()

    // 添加ID
    if (current.id) {
      selector += `#${current.id}`
    }

    // 添加类名
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c)
      if (classes.length > 0) {
        selector += '.' + classes.join('.')
      }
    }

    // 添加nth-child
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children)
      const index = siblings.indexOf(current)
      if (siblings.length > 1) {
        selector += `:nth-child(${index + 1})`
      }
    }

    path.unshift(selector)
    current = current.parentElement
  }

  return path.join(' > ')
}

/**
 * 获取元素下的所有文本节点
 *
 * ⚠️ 关键：必须与 mark-renderer 中的 getAllTextNodes 保持完全一致
 */
export function getAllTextNodes(element: HTMLElement): Node[] {
  const unsupportTags = ['UNSUPPORT-VIDEO', 'SCRIPT', 'STYLE', 'NOSCRIPT']
  const textNodes: Node[] = []

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node)
    } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      unsupportTags.indexOf((node as Element).tagName) === -1
    ) {
      node.childNodes.forEach((child) => traverse(child))
    }
  }

  traverse(element)
  return textNodes
}

/**
 * 获取Range的文本（包含换行）
 */
export function getRangeTextWithNewlines(range: Range): string {
  const selection = window.getSelection()
  if (!selection) {
    const temp = document.createElement('div')
    temp.appendChild(range.cloneContents())
    return temp.innerText
  }

  const originalRanges: Range[] = []
  for (let i = 0; i < selection.rangeCount; i++) {
    originalRanges.push(selection.getRangeAt(i))
  }

  try {
    selection.removeAllRanges()
    selection.addRange(range)
    const text = selection.toString()
    return text
  } finally {
    selection.removeAllRanges()
    for (const originalRange of originalRanges) {
      selection.addRange(originalRange)
    }
  }
}

/**
 * 深度比较两个对象是否相等
 */
export function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true

  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
    return false
  }

  const keys1 = Object.keys(obj1)
  const keys2 = Object.keys(obj2)

  if (keys1.length !== keys2.length) return false

  for (const key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false
    }
  }

  return true
}
