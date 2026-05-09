import { ImageClickProcessor } from '../../../src/handlers/processors/image-click.processor'
import * as nativeBridge from '../../../src/bridge/native-bridge'
import type { ProcessorContext } from '../../../src/handlers/types'

function createImg(src?: string, naturalWidth = 0, naturalHeight = 0): HTMLImageElement {
    const img = document.createElement('img')
    if (src !== undefined) {
        img.src = src
    }
    Object.defineProperty(img, 'naturalWidth', { get: () => naturalWidth, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { get: () => naturalHeight, configurable: true })
    return img
}

function createContext(): ProcessorContext {
    return { document }
}

describe('ImageClickProcessor', () => {
    let processor: ImageClickProcessor

    beforeEach(() => {
        document.body.innerHTML = ''
        processor = new ImageClickProcessor()
        jest.spyOn(nativeBridge, 'postToNativeBridge')
    })

    describe('match', () => {
        test('有 img 元素时返回 true', () => {
            document.body.innerHTML = '<img src="https://example.com/1.jpg">'
            expect(processor.match(createContext())).toBe(true)
        })

        test('没有图片元素时返回 false', () => {
            document.body.innerHTML = '<div>no images</div>'
            expect(processor.match(createContext())).toBe(false)
        })
    })

    describe('无 src 图片过滤', () => {
        test('没有 src 的 img 应被隐藏 (display: none)', () => {
            const img = document.createElement('img')
            document.body.appendChild(img)

            processor.process(createContext())

            expect(img.style.display).toBe('none')
        })

        test('没有 src 的 img 不应绑定点击事件', () => {
            const imgNoSrc = document.createElement('img')
            const imgWithSrc = createImg('https://example.com/1.jpg')
            document.body.appendChild(imgNoSrc)
            document.body.appendChild(imgWithSrc)

            processor.process(createContext())

            imgNoSrc.click()
            expect(nativeBridge.postToNativeBridge).not.toHaveBeenCalled()

            imgWithSrc.click()
            expect(nativeBridge.postToNativeBridge).toHaveBeenCalledTimes(1)
        })

        test('没有 src 的 img 不应出现在 allImages 列表中', () => {
            const imgNoSrc = document.createElement('img')
            const img1 = createImg('https://example.com/1.jpg')
            const img2 = createImg('https://example.com/2.jpg')
            document.body.appendChild(imgNoSrc)
            document.body.appendChild(img1)
            document.body.appendChild(img2)

            processor.process(createContext())

            img1.click()
            expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
                type: 'imageClick',
                src: 'https://example.com/1.jpg',
                allImages: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
                index: 0
            })
        })

        test('没有 src 的 img 不应添加 loading 类', () => {
            const imgNoSrc = document.createElement('img')
            const imgWithSrc = createImg('https://example.com/1.jpg')
            document.body.appendChild(imgNoSrc)
            document.body.appendChild(imgWithSrc)

            processor.process(createContext())

            expect(imgNoSrc.classList.contains('slax-image-loading')).toBe(false)
            expect(imgWithSrc.classList.contains('slax-image-loading')).toBe(true)
        })

        test('多个无 src 的 img 都应被隐藏', () => {
            const img1 = document.createElement('img')
            const img2 = document.createElement('img')
            const imgWithSrc = createImg('https://example.com/valid.jpg')
            document.body.appendChild(img1)
            document.body.appendChild(img2)
            document.body.appendChild(imgWithSrc)

            processor.process(createContext())

            expect(img1.style.display).toBe('none')
            expect(img2.style.display).toBe('none')
            expect(imgWithSrc.style.display).not.toBe('none')
        })
    })

    describe('图片点击', () => {
        test('应该处理图片点击', () => {
            const img1 = createImg('https://example.com/1.jpg')
            const img2 = createImg('https://example.com/2.jpg')
            document.body.appendChild(img1)
            document.body.appendChild(img2)

            processor.process(createContext())

            img2.click()

            expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
                type: 'imageClick',
                src: 'https://example.com/2.jpg',
                allImages: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
                index: 1
            })
        })

        test('应该忽略非 http 图片', () => {
            const img1 = createImg('data:image/png;base64,...')
            const img2 = createImg('https://example.com/valid.jpg')
            document.body.appendChild(img1)
            document.body.appendChild(img2)

            processor.process(createContext())

            img2.click()

            expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
                type: 'imageClick',
                src: 'https://example.com/valid.jpg',
                allImages: ['https://example.com/valid.jpg'],
                index: 0
            })
        })
    })

    describe('handleImageLoading', () => {
        test('应该清空 srcset 并添加 loading 类', () => {
            const img = createImg('https://example.com/1.jpg')
            img.srcset = 'https://example.com/1x.jpg 1x'
            document.body.appendChild(img)

            processor.process(createContext())

            expect(img.srcset).toBe('')
            expect(img.classList.contains('slax-image-loading')).toBe(true)
        })

        test('应该清空 referrerPolicy', () => {
            const img = createImg('https://example.com/1.jpg')
            img.referrerPolicy = 'no-referrer'
            document.body.appendChild(img)

            processor.process(createContext())

            expect(img.referrerPolicy).toBe('')
        })

        test('onload: 尺寸过小的图片应隐藏', () => {
            const img = createImg('https://example.com/tiny.jpg', 3, 3)
            document.body.appendChild(img)

            processor.process(createContext())
            img.onload!(new Event('load'))

            expect(img.classList.contains('slax-image-loading')).toBe(false)
            expect(img.getAttribute('style')).toBe('display: none;')
        })

        test('onload: 宽度小于 200 的图片应设置固定宽度', () => {
            const img = createImg('https://example.com/small.jpg', 100, 80)
            document.body.appendChild(img)

            processor.process(createContext())
            img.onload!(new Event('load'))

            expect(img.getAttribute('style')).toBe('width: 100px !important;')
        })

        test('onload: 正常尺寸图片应设置 padding 和 height 样式', () => {
            const img = createImg('https://example.com/normal.jpg', 400, 300)
            document.body.appendChild(img)

            processor.process(createContext())
            img.onload!(new Event('load'))

            expect(img.getAttribute('style')).toBe('height: auto !important;')
        })

        test('onerror: 应移除 loading 类并隐藏图片', () => {
            const img = createImg('https://example.com/broken.jpg')
            document.body.appendChild(img)

            processor.process(createContext())
            img.onerror!(new Event('error'))

            expect(img.classList.contains('slax-image-loading')).toBe(false)
            expect(img.style.display).toBe('none')
        })

        test('父元素只含图片时应清除 float', () => {
            const wrapper = document.createElement('div')
            const img1 = createImg('https://example.com/a.jpg')
            const img2 = createImg('https://example.com/b.jpg')
            img1.style.cssFloat = 'left'
            wrapper.appendChild(img1)
            wrapper.appendChild(img2)
            document.body.appendChild(wrapper)

            processor.process(createContext())

            expect(img1.style.cssFloat).toBe('none')
        })

        test('父元素含非图片子节点时不应清除 float', () => {
            const wrapper = document.createElement('div')
            const img = createImg('https://example.com/a.jpg')
            img.style.cssFloat = 'left'
            const span = document.createElement('span')
            wrapper.appendChild(img)
            wrapper.appendChild(span)
            document.body.appendChild(wrapper)

            processor.process(createContext())

            expect(img.style.cssFloat).toBe('left')
        })
    })

    describe('unwrapImgAnchorsInTweet', () => {
        function setupTweetBody(innerHTML: string) {
            const div = document.createElement('div')
            div.className = 'tweet'
            div.innerHTML = innerHTML
            document.body.appendChild(div)
        }

        test('tweet 内容中 a 标签包裹的 img 应被解包', () => {
            setupTweetBody('<a href="https://t.co/x"><img src="https://example.com/photo.jpg"></a>')

            processor.process(createContext())

            const tweetDiv = document.body.querySelector('.tweet')!
            expect(tweetDiv.querySelector('a')).toBeNull()
            expect(tweetDiv.querySelector('img')).not.toBeNull()
        })

        test('非 tweet 内容中的 a img 不应被解包', () => {
            const div = document.createElement('div')
            div.className = 'article'
            div.innerHTML = '<a href="https://example.com"><img src="https://example.com/photo.jpg"></a>'
            document.body.appendChild(div)

            processor.process(createContext())

            expect(div.querySelector('a')).not.toBeNull()
            expect(div.querySelector('img')).not.toBeNull()
        })
    })
})
