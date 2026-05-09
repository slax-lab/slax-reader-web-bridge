import { DOMPipeline } from './dom-pipeline'
import { ImageClickProcessor } from './processors/image-click.processor'
import { BookmarkNotFoundProcessor } from './processors/bookmark-notfound.processor'

export class DefaultDOMHandler {
    private pipeline: DOMPipeline

    constructor() {
        this.pipeline = new DOMPipeline()
        this.pipeline.register(
            new ImageClickProcessor(),
            new BookmarkNotFoundProcessor(),
        )
    }

    async run(): Promise<void> {
        await this.pipeline.run({ document })
    }
}
