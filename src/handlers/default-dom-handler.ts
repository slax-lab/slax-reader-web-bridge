import { DOMPipeline } from './dom-pipeline'
import { ImageClickProcessor } from './processors/image-click.processor'
import { BookmarkNotFoundProcessor } from './processors/bookmark-notfound.processor'
import { SpanProcessor } from './processors/span.processor'
import { ListProcessor } from './processors/list.processor'
import { SvgProcessor } from './processors/svg.processor'
import { BlankMarkProcessor } from './processors/blank-mark.processor'
import { PreLineProcessor } from './processors/preline.processor'
import { IFrameProcessor } from './processors/iframe.processor'
import { TableLayoutProcessor } from './processors/table-layout.processor'
import { DetailsProcessor } from './processors/details.processor'

export class DefaultDOMHandler {
    private pipeline: DOMPipeline
    readonly images = new ImageClickProcessor()
    private tables = new TableLayoutProcessor()

    constructor() {
        this.pipeline = new DOMPipeline()
        this.pipeline.register(
            this.images,
            new BookmarkNotFoundProcessor(),
            new SvgProcessor(),
            new SpanProcessor(),
            new ListProcessor(),
            new BlankMarkProcessor(),
            new PreLineProcessor(),
            new DetailsProcessor(),
            new IFrameProcessor(),
            this.tables,
        )
    }

    dispose(): void { this.pipeline.dispose(); this.images.dispose(); this.tables.dispose() }

    async run(): Promise<void> {
        await this.pipeline.run({ document })
    }
}
