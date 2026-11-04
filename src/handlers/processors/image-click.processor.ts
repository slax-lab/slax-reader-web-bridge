import type {DOMProcessor, ProcessorContext} from '../types'
import {postToNativeBridge} from '../../bridge/native-bridge'

function getImageUrl(element: Element): string {
  if (element.tagName.toLowerCase() === 'img') {
    const image = element as HTMLImageElement
    return image.currentSrc || (image.getAttribute('src')?.trim() ? image.src : '')
  }
  const image = element as SVGImageElement
  return image.href?.baseVal || image.getAttribute('href') || image.getAttribute('xlink:href') || ''
}

function hasDisplaySize(image: HTMLImageElement): boolean {
  return ['width', 'height', 'max-width', 'max-height'].some(property => {
    const value = image.style.getPropertyValue(property).trim()
    if (property.startsWith('max-') && value === '100%') return false
    return Boolean(value && !/^(auto|none|initial|inherit|unset|revert(?:-layer)?|0(?:px|%)?)$/i.test(value))
  })
}

function ensurePaddingAndHeight(image: HTMLImageElement): void {
  const style = image.getAttribute('style') || ''
  const has = (property: string) => new RegExp(`(^|;)\\s*${property}\\s*:`, 'i').test(style)
  const missing = [!has('padding') && 'padding: 0 !important', !has('height') && 'height: auto !important'].filter(Boolean)
  if (!missing.length) return
  const trimmed = style.trim()
  const separator = trimmed ? (trimmed.endsWith(';') ? ' ' : '; ') : ''
  image.setAttribute('style', `${trimmed}${separator}${missing.join('; ')};`)
}

interface ImageState {
  authoredDisplaySize: boolean
  hidden: boolean
  previousDisplay: string
}

export class ImageClickProcessor implements DOMProcessor {
  readonly name = 'ImageClickProcessor'
  private images: Element[] = []
  private states = new WeakMap<HTMLImageElement, ImageState>()
  private cleanupResize?: () => void

  match(context: ProcessorContext): boolean { return context.document.querySelector('img, image') !== null }

  dispose(): void {
    this.cleanupResize?.(); this.cleanupResize = undefined
    for (const image of this.images) {
      ;(image as HTMLImageElement | SVGImageElement).onclick = null
      if (image.tagName.toLowerCase() === 'img') {
        ;(image as HTMLImageElement).onload = null
        ;(image as HTMLImageElement).onerror = null
      }
    }
    this.images = []
  }

  process(context: ProcessorContext): void {
    this.dispose()
    const doc = context.document
    const root = doc.body.querySelector<HTMLElement>(':scope > div') ?? doc.body
    const card = root.matches('.tweet, .social-post') ? root : root.firstElementChild
    if (card?.matches('.tweet, .social-post')) {
      for (const image of Array.from(card.querySelectorAll('a img'))) {
        const anchor = image.closest('a')!
        anchor.replaceWith(...Array.from(anchor.childNodes))
      }
    }
    this.images = Array.from(doc.querySelectorAll('img, image')).filter(image => {
      if (getImageUrl(image)) return true
      if (image.tagName.toLowerCase() === 'img') (image as HTMLElement).style.display = 'none'
      return false
    })
    // Metadata arrives after domReady. Preserve authored sizing until its source host is known.
    const preserveStyle = !context.url || context.url.hostname === 'mp.weixin.qq.com'
    const htmlImages = this.images.filter(image => image.tagName.toLowerCase() === 'img') as HTMLImageElement[]
    const bindPreview = (image: Element) => {
      ;(image as HTMLImageElement | SVGImageElement).onclick = () => {
        const valid = this.images.filter(item => !this.states.get(item as HTMLImageElement)?.hidden)
          .map(getImageUrl).filter(url => /^(https?:\/\/|slaxstatics?:\/\/)/.test(url))
        const url = getImageUrl(image)
        const index = valid.indexOf(url)
        if (index >= 0) postToNativeBridge({type: 'imageClick', src: url, allImages: valid, index})
        return false
      }
    }
    for (const image of this.images) bindPreview(image)
    for (const image of htmlImages) {
      const state = this.states.get(image) ?? {authoredDisplaySize: hasDisplaySize(image), hidden: false, previousDisplay: ''}
      this.states.set(image, state)
      const changedSourceSelection = Boolean(image.getAttribute('srcset') || image.closest('picture')?.querySelector('source[srcset]'))
      const hide = () => {
        if (!state.hidden) state.previousDisplay = image.style.display
        state.hidden = true
        image.classList.remove('slax-image-loading')
        image.onclick = null
        image.style.display = 'none'
      }
      const handleLoad = () => {
        image.classList.remove('slax-image-loading')
        image.onclick = null
        if (state.hidden) { image.style.display = state.previousDisplay; state.hidden = false }
        if (image.naturalWidth < 5 || image.naturalHeight < 5) { hide(); return }
        if (image.naturalWidth < 200 && !(preserveStyle && state.authoredDisplaySize)) {
          image.setAttribute('style', `width: ${image.naturalWidth}px !important;`)
        } else {
          if (!preserveStyle) image.removeAttribute('style')
          ensurePaddingAndHeight(image)
        }
        bindPreview(image)
      }
      image.onload = handleLoad
      image.onerror = hide
      if (state.hidden) image.onclick = null
      image.classList.add('slax-image-loading')
      if (image.getAttribute('srcset')) image.srcset = ''
      if (image.referrerPolicy) image.referrerPolicy = ''
      const siblings = Array.from(image.parentElement!.childNodes)
      if (siblings.every(child => child.nodeType !== Node.ELEMENT_NODE || (child as Element).tagName.toLowerCase() === 'img')) image.style.cssFloat = 'none'
      const catchUp = () => {
        if (image.onload !== handleLoad || !image.complete) return
        if (image.naturalWidth > 0) handleLoad()
        else hide()
      }
      if (changedSourceSelection) queueMicrotask(catchUp)
      else catchUp()
    }
    if (!preserveStyle) return
    const fixed = htmlImages.filter(image => /^[\d.]+px$/.test(image.style.width) && /^[\d.]+px$/.test(image.style.height) && !/^(cover|contain|none|scale-down)$/i.test(image.style.objectFit))
    const fit = () => {
      const width = root.clientWidth
      if (width <= 0) return
      for (const image of fixed) {
        if (image.style.width.endsWith('px') && parseFloat(image.style.width) > width) {
          image.style.setProperty('width', '100%', 'important')
          image.style.setProperty('height', 'auto', 'important')
        }
      }
    }
    fit()
    const view = doc.defaultView
    if (!fixed.length || !view?.ResizeObserver) return
    let frame = 0
    const observer = new view.ResizeObserver(() => {
      view.cancelAnimationFrame(frame)
      frame = view.requestAnimationFrame(fit)
    })
    observer.observe(root)
    this.cleanupResize = () => { observer.disconnect(); view.cancelAnimationFrame(frame) }
  }
}
