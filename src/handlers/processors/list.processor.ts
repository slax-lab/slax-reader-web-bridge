import type { DOMProcessor, ProcessorContext } from '../types'

export class ListProcessor implements DOMProcessor {
    readonly name = 'ListProcessor'

    match(context: ProcessorContext): boolean {
        return context.document.querySelectorAll('ul').length > 0
    }

    process(context: ProcessorContext): void {
        const uls = context.document.querySelectorAll('ul')

        uls.forEach(ul => {
            if (ul.querySelector('li')) {
                ul.classList.add('has-li')
            }
        })

        console.log(`[ListProcessor] Processed ${uls.length} ul elements`)
    }
}
