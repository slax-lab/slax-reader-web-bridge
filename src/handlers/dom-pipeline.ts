import type { DOMProcessor, ProcessorContext } from './types'

export class DOMPipeline {
    private disposed = false
    private processors: DOMProcessor[] = []

    register(...processors: DOMProcessor[]): this {
        this.processors.push(...processors)
        return this
    }

    dispose(): void { this.disposed = true }

    async run(context: ProcessorContext): Promise<void> {
        for (const processor of this.processors) {
            if (this.disposed) return
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
