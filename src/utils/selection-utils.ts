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

    if (current.id) {
      const id = current.id
      if (/^\d/.test(id)) {
        selector += `[id="${id}"]`
      } else if (/[^a-zA-Z0-9_-]/.test(id)) {
        selector += `[id="${id}"]`
      } else {
        selector += `#${id}`
      }
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c)
      for (const cls of classes) {
        if (/[^a-zA-Z0-9_-]/.test(cls) || /^\d/.test(cls)) {
          selector += `[class~="${cls.replace(/"/g, '\\"')}"]`
        } else {
          selector += `.${cls}`
        }
      }
    }

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children)
      if (siblings.length > 1) {
        let hasDuplicate = false
        try {
          hasDuplicate = siblings.some(s => s !== current && s.matches(selector))
        } catch {
          hasDuplicate = true
        }
        if (hasDuplicate) {
          const index = siblings.indexOf(current)
          selector += `:nth-child(${index + 1})`
        }
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
 * 修复无效的 CSS 选择器
 * 处理范围：
 *   1. 以数字开头的 ID / Class
 *   2. 含有特殊字符（: * ! / [ ] 等）的 Class（如 Tailwind CSS 变体类名）
 *   3. 含有转义符（反斜杠）的 Class
 */
export function fixCssSelector(selector: string): string {
  const preserved: string[] = []
  const preserve = (m: string): string => {
    preserved.push(m)
    return `\x01${preserved.length - 1}\x01`
  }

  // 保护属性选择器 [xxx]
  let safened = selector.replace(/\[[^\]]+\]/g, preserve)
  // 保护伪元素 ::before 等
  safened = safened.replace(/::[a-zA-Z-]+/g, preserve)
  // 保护带参数的伪类 :nth-child(...) 等
  safened = safened.replace(/:(?:nth-child|nth-of-type|nth-last-child|nth-last-of-type)\([^)]+\)/g, preserve)
  // 保护简单伪类 :hover, :focus 等
  safened = safened.replace(
    /:(?:hover|focus|active|visited|checked|disabled|enabled|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type|empty|not|is|where|has|root|lang|target|focus-within|focus-visible|placeholder-shown|default|read-only|read-write|required|optional|valid|invalid|in-range|out-of-range)(?=[\s,.>+~:[\]()#]|$)/g,
    preserve
  )

  // 以数字开头的 ID → [id="xxx"]
  safened = safened.replace(/#(\d[-\w]*)/g, (_, id) => `[id="${id}"]`)

  // 含特殊字符或以数字开头的 Class → [class~="xxx"]
  safened = safened.replace(
    /\.(?:\\.|[^\s.#>+~[\](),{}\x01])+/g,
    (match) => {
      const raw = match.slice(1)
      if (/[^a-zA-Z0-9_-]/.test(raw) || /^\d/.test(raw)) {
        const cleaned = raw.replace(/\\(.)/g, '$1')
        return `[class~="${cleaned}"]`
      }
      return match
    }
  )

  // 还原暂存的合法选择器片段
  safened = safened.replace(/\x01(\d+)\x01/g, (_, i) => preserved[+i])

  return safened
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
