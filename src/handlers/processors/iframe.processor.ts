import type {DOMProcessor, ProcessorContext} from '../types'

export class IFrameProcessor implements DOMProcessor {
  readonly name = 'IFrameProcessor'
  match(): boolean { return true }
  process(context: ProcessorContext): void {
    for (const iframe of Array.from(context.document.querySelectorAll('iframe'))) {
      if (Number(iframe.width) > 100) iframe.width = '100%'
    }
  }
}
