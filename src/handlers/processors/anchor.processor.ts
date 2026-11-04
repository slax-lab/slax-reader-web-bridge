import type {DOMProcessor, ProcessorContext} from '../types'

export class AnchorProcessor implements DOMProcessor {
  readonly name = 'AnchorProcessor'

  match(context: ProcessorContext): boolean { return context.url !== undefined }

  process(context: ProcessorContext): void {
    for (const anchor of Array.from(context.document.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href')?.trim()
      if (!href) continue
      if (href.startsWith('#')) { anchor.target = ''; continue }
      let target: URL
      try { target = new URL(href, context.url) } catch { continue }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') continue
      anchor.href = target.href
      anchor.target = '_blank'
    }
  }
}
