import type { DOMProcessor, ProcessorContext } from '../types'

// 含 <summary> 的 <details> 自动展开（移植自 dweb）
export class DetailsProcessor implements DOMProcessor {
  readonly name = 'DetailsProcessor'

  match(): boolean {
    return true
  }

  process(context: ProcessorContext): void {
    const details = Array.from(context.document.querySelectorAll('details')) as HTMLDetailsElement[]

    details.forEach(detail => {
      if (detail.querySelector('summary') && !detail.classList.contains('slax-yt-contents')) {
        detail.open = true
      }
    })

    console.log(`[DetailsProcessor] Processed ${details.length} details elements`)
  }
}
