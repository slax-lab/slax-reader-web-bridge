import type { DOMProcessor, ProcessorContext } from '../types'

// 标记纯空白容器，CSS :has(>.oc-blank-flag) 隐藏
// 移植自 dweb BlankMarkProcessor（去 SSR）

const CANDIDATE_SELECTOR = 'section, p, figure, h1, h2, h3, h4, div'
// 含这些视觉元素则不算空白
const VISUAL_SELECTOR = 'img, video, svg, iframe, picture, canvas, audio, object, embed, table'

export const BLANK_FLAG_CLASS = 'oc-blank-flag'

function isBlankText(text: string): boolean {
  return text.trim().length === 0
}

// 内联 display:none 也当空白
function isStyleHidden(styleAttr: string | null | undefined): boolean {
  return /display\s*:\s*none\b/i.test(styleAttr ?? '')
}

export class BlankMarkProcessor implements DOMProcessor {
  readonly name = 'BlankMarkProcessor'

  match(): boolean {
    return true
  }

  process(context: ProcessorContext): void {
    // 只处理正文容器 body>div
    const root = context.document.body?.querySelector<HTMLElement>(':scope > div')
    if (!root) return

    const markBlank = (el: HTMLElement): void => {
      const marker = context.document.createElement('template')
      marker.className = BLANK_FLAG_CLASS
      el.appendChild(marker)
    }

    const candidates = Array.from(root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR))

    for (const el of candidates) {
      // 幂等
      if (el.querySelector(`:scope > .${BLANK_FLAG_CLASS}`)) continue

      // 内联隐藏直接当空白
      if (isStyleHidden(el.getAttribute('style'))) {
        markBlank(el)
        continue
      }

      if (el.querySelector(VISUAL_SELECTOR)) continue
      if (!isBlankText(el.textContent ?? '')) continue

      markBlank(el)
    }

    console.log(`[BlankMarkProcessor] Processed ${candidates.length} candidate elements`)
  }
}
