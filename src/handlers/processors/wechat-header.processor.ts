import type { DOMProcessor, ProcessorContext } from '../types'

export class WechatHeaderProcessor implements DOMProcessor {
    readonly name = 'WechatHeaderProcessor'

    match(context: ProcessorContext): boolean {
        if (!context.infoPack) return false

        const metadataUrl = String(context.infoPack.metadataUrl ?? '')
        return metadataUrl.startsWith('https://mp.weixin.qq.com')
    }

    process(context: ProcessorContext): void {
        const spans = context.document.querySelectorAll('span#meta_content_hide_info')

        spans.forEach(span => {
            const p = span.parentElement
            if (!p || p.tagName.toLowerCase() !== 'p') return

            const children = Array.from(p.children)
            let score = 0

            if (p.parentElement?.tagName.toLowerCase() === 'div'
                && p.parentElement.classList.contains('img-content')) {
                score++
            }

            if (children[0]?.tagName.toLowerCase() === 'span'
                && children[0].id === 'copyright_logo') {
                score++
            }

            if (children[2]?.tagName.toLowerCase() === 'span'
                && children[2].id === 'profileBt') {
                score++
            }

            if (score >= 2) {
                p.remove()
            }
        })
    }
}
