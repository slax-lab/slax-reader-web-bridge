import type { DOMProcessor, ProcessorContext } from '../types'
import { postToNativeBridge } from '../../bridge/native-bridge'

export class BookmarkNotFoundProcessor implements DOMProcessor {
    readonly name = 'BookmarkNotFoundProcessor'

    match(context: ProcessorContext): boolean {
        return !!context.document.querySelector(
            'body > .slax-reader-notfound-container > .slax-reader-notfound-btn-container'
        )
    }

    process(context: ProcessorContext): void {
        const container = context.document.querySelector(
            'body > .slax-reader-notfound-container > .slax-reader-notfound-btn-container'
        )!

        const retryBtn = container.querySelector('.retry-btn')
        const feedbackBtn = container.querySelector('.feedback-btn')

        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                postToNativeBridge({ type: 'refreshContent' })
                console.log('[BookmarkNotFoundProcessor] Retry button clicked')
            })
        }

        if (feedbackBtn) {
            feedbackBtn.addEventListener('click', () => {
                postToNativeBridge({ type: 'feedback' })
                console.log('[BookmarkNotFoundProcessor] Feedback button clicked')
            })
        }

        console.log('[BookmarkNotFoundProcessor] Initialized bookmark not found handlers')
    }
}
