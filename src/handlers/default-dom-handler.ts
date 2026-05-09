import { DOMPipeline } from './dom-pipeline'
import { ImageClickProcessor } from './processors/image-click.processor'
import { BookmarkNotFoundProcessor } from './processors/bookmark-notfound.processor'
import { SpanProcessor } from './processors/span.processor'
import { ListProcessor } from './processors/list.processor'
import { SvgProcessor } from './processors/svg.processor'

export class DefaultDOMHandler {
    private pipeline: DOMPipeline

    constructor() {
        this.pipeline = new DOMPipeline()
        this.pipeline.register(
            new ImageClickProcessor(),
            new BookmarkNotFoundProcessor(),
            new SvgProcessor(),
            new SpanProcessor(),
            new ListProcessor(),
        )
    }

    async run(): Promise<void> {
        await this.pipeline.run({ document })
    }
}
