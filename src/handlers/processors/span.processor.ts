import type { DOMProcessor, ProcessorContext } from '../types'

export class SpanProcessor implements DOMProcessor {
    readonly name = 'SpanProcessor'

    match(context: ProcessorContext): boolean {
        return context.document.querySelectorAll('span').length > 0
    }

    process(context: ProcessorContext): void {
        const spans = context.document.querySelectorAll('span')

        spans.forEach(span => {
            const el = span as HTMLSpanElement
            if (
                el.textContent?.replace(/ /g, '').trim().length === 0 &&
                !el.querySelector('img[src], video[src], picture:has(source[srcset]), svg, canvas')
            ) {
                el.style.display = 'none'
            }
        })

        console.log(`[SpanProcessor] Processed ${spans.length} span elements`)
    }
}
