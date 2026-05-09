export type InfoPack = any

export interface ProcessorContext {
    document: Document
    infoPack?: InfoPack
}

export interface DOMProcessor {
    readonly name: string
    match(context: ProcessorContext): boolean
    process(context: ProcessorContext): void | Promise<void>
}
