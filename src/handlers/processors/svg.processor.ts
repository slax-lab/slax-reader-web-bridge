import type { DOMProcessor, ProcessorContext } from '../types'

export class SvgProcessor implements DOMProcessor {
    readonly name = 'SvgProcessor'

    match(context: ProcessorContext): boolean {
        return context.document.querySelectorAll('svg').length > 0
    }

    process(context: ProcessorContext): void {
        const svgs = context.document.querySelectorAll('svg')

        svgs.forEach(svg => {
            const el = svg as SVGSVGElement
            const paths = el.getElementsByTagName('path')
            if (paths.length < 10) {
                el.setAttribute('style', 'display: none;')
                return
            }

            const viewBox = el.viewBox
            if (!viewBox) return

            const { width, height } = viewBox.baseVal
            if (width < 5 || height < 5) {
                el.setAttribute('style', 'display: none;')
            } else {
                el.setAttribute('style', `width: ${width}px !important; height: ${height}px !important;`)
            }
        })

        console.log(`[SvgProcessor] Processed ${svgs.length} svg elements`)
    }
}
