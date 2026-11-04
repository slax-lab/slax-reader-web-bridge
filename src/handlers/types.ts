export type InfoPack = Record<string, string | number | boolean | null>

export interface ProcessorContext {
    document: Document
    infoPack?: InfoPack
    url?: URL
}

export interface DOMProcessor {
    readonly name: string
    match(context: ProcessorContext): boolean
    process(context: ProcessorContext): void | Promise<void>
}
