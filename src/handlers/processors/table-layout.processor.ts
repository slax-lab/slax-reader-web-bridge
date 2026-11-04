import type {DOMProcessor, ProcessorContext} from '../types'

/** Keep annotation-bearing table nodes and horizontal scroll offsets intact. */
export class TableLayoutProcessor implements DOMProcessor {
  readonly name = 'TableLayoutProcessor'
  private cleanup?: () => void
  match(): boolean { return true }
  dispose(): void { this.cleanup?.(); this.cleanup = undefined }

  process(context: ProcessorContext): void {
    this.dispose()
    const tables = Array.from(context.document.querySelectorAll('table'))
    const view = context.document.defaultView
    if (!view || !tables.length) return
    const update = () => {
      for (const table of tables) {
        table.classList.remove('slax-table-fit')
        if (table.clientWidth > 0 && table.scrollWidth <= table.clientWidth) table.classList.add('slax-table-fit')
      }
    }
    update()
    if (!view.ResizeObserver) return
    let frame = 0
    const observer = new view.ResizeObserver(() => {
      view.cancelAnimationFrame(frame)
      frame = view.requestAnimationFrame(update)
    })
    for (const table of tables) {
      if (table.parentElement) observer.observe(table.parentElement)
      observer.observe(table)
      for (const child of Array.from(table.children)) observer.observe(child)
    }
    this.cleanup = () => { observer.disconnect(); view.cancelAnimationFrame(frame) }
  }
}
