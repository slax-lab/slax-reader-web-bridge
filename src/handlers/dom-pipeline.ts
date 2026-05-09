import type { DOMProcessor, ProcessorContext } from './types'

export class DOMPipeline {
    private processors: DOMProcessor[] = []

    register(...processors: DOMProcessor[]): this {
        this.processors.push(...processors)
        return this
    }

    async run(context: ProcessorContext): Promise<void> {
        for (const processor of this.processors) {
            try {
                if (processor.match(context)) {
                    await processor.process(context)
                    console.log(`[DOMPipeline] ${processor.name} executed`)
                }
            } catch (error) {
                console.error(`[DOMPipeline] ${processor.name} failed:`, error)
            }
        }
    }
}
