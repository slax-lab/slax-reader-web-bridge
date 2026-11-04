import { ImageClickProcessor } from './processors/image-click.processor'
import { AnchorProcessor } from './processors/anchor.processor'
import { DOMPipeline } from './dom-pipeline'
import { WechatHeaderProcessor } from './processors/wechat-header.processor'
import type { InfoPack } from './types'

export class InfoPackDOMHandler {
    private pipeline: DOMPipeline

    constructor(images: ImageClickProcessor) {
        this.pipeline = new DOMPipeline()
        this.pipeline.register(
            new WechatHeaderProcessor(),
            images,
            new AnchorProcessor(),
        )
    }

    dispose(): void { this.pipeline.dispose() }

    async run(infoPack: InfoPack): Promise<void> {
        let url: URL | undefined
        if (typeof infoPack.metadataUrl === 'string') {
            try {
                const parsed = new URL(infoPack.metadataUrl)
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed
            } catch { /* Invalid source metadata leaves relative links unchanged. */ }
        }
        await this.pipeline.run({ document, infoPack, url })
    }
}
