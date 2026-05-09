import { DOMPipeline } from './dom-pipeline'
import { WechatHeaderProcessor } from './processors/wechat-header.processor'
import type { InfoPack } from './types'

export class InfoPackDOMHandler {
    private pipeline: DOMPipeline

    constructor() {
        this.pipeline = new DOMPipeline()
        this.pipeline.register(
            new WechatHeaderProcessor(),
        )
    }

    async run(infoPack: InfoPack): Promise<void> {
        await this.pipeline.run({ document, infoPack })
    }
}
