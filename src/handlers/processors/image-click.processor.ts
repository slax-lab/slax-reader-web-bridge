import type { DOMProcessor, ProcessorContext } from '../types'
import { postToNativeBridge } from '../../bridge/native-bridge'

function getImageUrl(element: Element): string {
    const tagName = element.tagName.toLowerCase()

    if (tagName === 'img') {
        const img = element as HTMLImageElement
        return img.currentSrc || img.src || ''
    }

    if (tagName === 'image') {
        const svgImage = element as SVGImageElement
        return svgImage.href?.baseVal ||
               element.getAttribute('href') ||
               element.getAttribute('xlink:href') ||
               ''
    }

    return ''
}

function handleImageLoading(imgs: HTMLImageElement[]) {
    const loadingKey = 'slax-image-loading'

    imgs.forEach(img => {
        img.srcset = ''

        img.onload = () => {
            img.classList.remove(loadingKey)

            if (img.naturalWidth < 5 || img.naturalHeight < 5) {
                img.setAttribute('style', 'display: none;')
                return
            } else if (img.naturalWidth < 200) {
                img.setAttribute('style', `width: ${img.naturalWidth}px !important;`)
                return
            }

            ['padding: 0 !important', 'height: auto !important;'].forEach(style => {
                img.setAttribute('style', style)
            })
        }

        img.referrerPolicy = ''

        img.onerror = () => {
            img.classList.remove(loadingKey)
            img.style.display = 'none'
        }

        img.classList.add(loadingKey)

        const parentElement = img.parentElement
        const parentChilds = parentElement ? Array.from(parentElement.childNodes) : []

        const isOnlyImages = parentChilds.every(child => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const element = child as HTMLElement
                return element.tagName.toLowerCase() === 'img'
            }
            return true
        })

        if (isOnlyImages) {
            img.style.cssFloat = 'none'
        }
    })
}

function unwrapImgAnchorsInTweet(doc: Document) {
    const firstDiv = doc.body?.querySelector(':scope > div')
    if (!firstDiv?.classList.contains('tweet')) return

    doc.querySelectorAll('a img').forEach(img => {
        const anchor = img.closest('a')
        if (!anchor) return
        const parent = anchor.parentNode
        if (!parent) return
        while (anchor.firstChild) {
            parent.insertBefore(anchor.firstChild, anchor)
        }
        parent.removeChild(anchor)
    })
}

export class ImageClickProcessor implements DOMProcessor {
    readonly name = 'ImageClickProcessor'

    match(context: ProcessorContext): boolean {
        return context.document.querySelectorAll('img, image').length > 0
    }

    process(context: ProcessorContext): void {
        const doc = context.document

        unwrapImgAnchorsInTweet(doc)

        const allImages = doc.querySelectorAll('img, image')
        const images: Element[] = []

        allImages.forEach(img => {
            const url = getImageUrl(img)
            if (!url) {
                if (img.tagName.toLowerCase() === 'img') {
                    ;(img as HTMLElement).style.display = 'none'
                }
                return
            }
            images.push(img)
        })

        const htmlImages = images.filter(img => img.tagName.toLowerCase() === 'img') as HTMLImageElement[]

        handleImageLoading(htmlImages)

        images.forEach(img => {
            img.addEventListener('click', (event) => {
                const validSchemes = ['https://', 'http://', 'slaxstatics://', 'slaxstatic://']
                const allImageUrls = images
                    .map(getImageUrl)
                    .filter(url => url && validSchemes.some(scheme => url.startsWith(scheme)))

                const currentTarget = event.currentTarget as Element
                const clickedImageUrl = getImageUrl(currentTarget)

                postToNativeBridge({
                    type: 'imageClick',
                    src: clickedImageUrl,
                    allImages: allImageUrls,
                    index: allImageUrls.indexOf(clickedImageUrl)
                })
            })
        })

        console.log(`[ImageClickProcessor] Initialized ${images.length} image click handlers`)
    }
}
