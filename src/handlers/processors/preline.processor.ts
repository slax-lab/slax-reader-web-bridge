import type { DOMProcessor, ProcessorContext } from '../types'

// 给多行 <p> 落 marker，CSS 转 pre-line
// 移植自 dweb PreLineProcessor（去 SSR）

// 只匹配换行控制符，不匹配文字 \n
const LINE_BREAK_RE = /\r\n|[\n\r\v\f\x85\u2028\u2029]/

export const PRELINE_FLAG_CLASS = 'oc-preline-flag'

// 有内容的行 ≥ 2 才算多行
function isMultiLine(text: string): boolean {
  return (
    text
      .split(LINE_BREAK_RE)
      .map(line => line.trim())
      .filter(Boolean).length >= 2
  )
}

export class PreLineProcessor implements DOMProcessor {
  readonly name = 'PreLineProcessor'

  match(): boolean {
    return true
  }

  process(context: ProcessorContext): void {
    // 只处理正文容器 body>div
    const root = context.document.body?.querySelector<HTMLElement>(':scope > div')
    if (!root) return

    const paragraphs = Array.from(root.querySelectorAll<HTMLElement>('p'))

    for (const el of paragraphs) {
      // 幂等
      if (el.querySelector(`:scope > .${PRELINE_FLAG_CLASS}`)) continue
      if (!isMultiLine(el.textContent ?? '')) continue

      const marker = context.document.createElement('template')
      marker.className = PRELINE_FLAG_CLASS
      el.appendChild(marker)
    }

    console.log(`[PreLineProcessor] Processed ${paragraphs.length} p elements`)
  }
}
