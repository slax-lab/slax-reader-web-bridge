import { SlaxWebViewBridge } from '../src/core/slax-webview-bridge'
import * as native from '../src/bridge/native-bridge'
import * as search from '../src/features/search'

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const observers: TestResizeObserver[] = []
const frames = new Map<number, FrameRequestCallback>()
class TestResizeObserver {
  targets: Element[] = []
  disconnected = false
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this) }
  observe(target: Element) { this.targets.push(target) }
  disconnect() { this.disconnected = true }
  unobserve() {}
  resize() { this.callback([], this as unknown as ResizeObserver) }
}
const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) }
function complete(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, {
    complete: {configurable: true, value: true},
    naturalWidth: {configurable: true, value: width},
    naturalHeight: {configurable: true, value: height},
  })
}
async function reader(html: string) {
  document.body.innerHTML = `<div id="content">${html}</div>`
  const bridge = new SlaxWebViewBridge()
  await settle()
  return bridge
}
async function metadata(bridge: SlaxWebViewBridge, url: string) {
  bridge.receiveInfoPack(JSON.stringify({metadataUrl: url}))
  await settle()
}

beforeEach(() => {
  observers.length = 0; frames.clear()
  Object.defineProperty(window, 'ResizeObserver', {configurable: true, value: TestResizeObserver})
  let frame = 0
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {frames.set(++frame, callback); return frame})
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {frames.delete(id)})
  jest.spyOn(native, 'postToNativeBridge')
})
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  window.getSelection()?.removeAllRanges()
  jest.useRealTimers(); jest.restoreAllMocks()
})

test('anchor highlighting stays silent but the next real user selection is reported', async () => {
  const bridge = await reader('<p id="heading">Anchor heading and user text</p>')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, value: () => ({top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20})})
  const heading = document.querySelector('#heading') as HTMLElement
  const range = document.createRange(); range.selectNodeContents(heading)
  jest.spyOn(search, 'findMatchingElement').mockReturnValue({element: heading, range})
  bridge.startSelectionMonitoring('#content', 1)
  jest.useFakeTimers()
  expect(bridge.scrollToAnchor('Anchor heading')).toBe(true)
  document.dispatchEvent(new Event('selectionchange')); jest.advanceTimersByTime(350)
  const selections = () => (native.postToNativeBridge as jest.Mock).mock.calls.filter(([message]) => message.type === 'textSelected')
  expect(selections()).toHaveLength(0)
  document.dispatchEvent(new MouseEvent('mousedown'))
  const userRange = document.createRange(); userRange.setStart(heading.firstChild!, 1); userRange.setEnd(heading.firstChild!, 6)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(userRange)
  document.dispatchEvent(new Event('selectionchange')); document.dispatchEvent(new MouseEvent('mouseup'))
  jest.advanceTimersByTime(350)
  expect(selections()).toHaveLength(1)
})

test('spans preserve explicit line breaks and contents details keep their original state', async () => {
  await reader('<span id="line"><br></span><span id="blank"> </span><details id="ordinary"><summary>More</summary>Text</details><details class="slax-yt-contents"><summary>Contents</summary>Topics</details>')
  expect((document.querySelector('#line') as HTMLElement).style.display).not.toBe('none')
  expect((document.querySelector('#blank') as HTMLElement).style.display).toBe('none')
  expect((document.querySelector('#ordinary') as HTMLDetailsElement).open).toBe(true)
  expect((document.querySelector('.slax-yt-contents') as HTMLDetailsElement).open).toBe(false)
})

test('metadata resolves relative URLs against the original page and preserves fragments and non-web schemes', async () => {
  const bridge = await reader('<a id="relative" href="../next?q=1">Next</a><a id="root" href="/docs">Docs</a><a id="hash" href="#section">Section</a><a id="mail" href="mailto:help@example.org">Mail</a><iframe width="800"></iframe>')
  await metadata(bridge, 'https://example.org/articles/current')
  expect(document.querySelector('#relative')!.getAttribute('href')).toBe('https://example.org/next?q=1')
  expect(document.querySelector('#root')!.getAttribute('href')).toBe('https://example.org/docs')
  expect(document.querySelector('#hash')!.getAttribute('href')).toBe('#section')
  expect((document.querySelector('#hash') as HTMLAnchorElement).target).toBe('')
  expect(document.querySelector('#mail')!.getAttribute('href')).toBe('mailto:help@example.org')
  expect(document.querySelector('iframe')!.getAttribute('width')).toBe('100%')
})

test('tables fit short content, retain wide scroll and DOM nodes, resize, and release observers', async () => {
  document.body.innerHTML = '<div id="content"><table><tbody><tr><td>Original</td></tr></tbody></table></div>'
  const table = document.querySelector('table')!, cell = document.querySelector('td')!
  let width = 180
  Object.defineProperties(table, {clientWidth: {get: () => 240}, scrollWidth: {get: () => width}})
  const bridge = new SlaxWebViewBridge(); await settle()
  expect(table.classList.contains('slax-table-fit')).toBe(true)
  const observer = observers.find(observer => observer.targets.includes(table))!
  expect(observer).toBeDefined()
  width = 500; table.scrollLeft = 37; observer.resize(); flushFrames()
  expect(table.classList.contains('slax-table-fit')).toBe(false)
  expect(table.scrollLeft).toBe(37)
  expect(document.querySelector('td')).toBe(cell)
  width = 100; observer.resize(); flushFrames()
  expect(table.classList.contains('slax-table-fit')).toBe(true)
  observer.resize(); expect(frames.size).toBe(1)
  window.dispatchEvent(new Event('pagehide'))
  expect(observer.disconnected).toBe(true); expect(frames.size).toBe(0)
  await metadata(bridge, 'https://example.org/')
  expect(observers.filter(item => !item.disconnected)).toHaveLength(0)
})

test('completed WeChat images preserve authored icon sizes and styles across late metadata', async () => {
  document.body.innerHTML = '<div><img id="icon" src="https://images.example.org/icon.png" style="width:32px;height:32px;margin-left:4px!important"><img id="large" src="https://images.example.org/large.png" style="width:600px;height:400px"></div>'
  const root = document.body.firstElementChild!, icon = document.querySelector('#icon') as HTMLImageElement, large = document.querySelector('#large') as HTMLImageElement
  Object.defineProperty(root, 'clientWidth', {value: 260})
  complete(icon, 64, 64); complete(large, 600, 400)
  const bridge = new SlaxWebViewBridge(); await settle(); await metadata(bridge, 'https://mp.weixin.qq.com/s/article')
  expect(icon.style.width).toBe('32px'); expect(icon.style.height).toBe('32px'); expect(icon.style.marginLeft).toBe('4px')
  expect(icon.classList.contains('slax-image-loading')).toBe(false)
  expect(large.style.width).toBe('100%'); expect(large.style.height).toBe('auto')
  const before = (native.postToNativeBridge as jest.Mock).mock.calls.length
  icon.click()
  expect((native.postToNativeBridge as jest.Mock).mock.calls.slice(before).filter(([message]) => message.type === 'imageClick')).toHaveLength(1)
})

test('failed images recover after a source replacement without retaining obsolete preview actions', async () => {
  const bridge = await reader('<img src="https://images.example.org/old.png">')
  const image = document.querySelector('img')!
  image.dispatchEvent(new Event('error'))
  expect(image.style.display).toBe('none')
  jest.clearAllMocks(); image.click(); expect(native.postToNativeBridge).not.toHaveBeenCalled()
  image.src = 'https://images.example.org/new.png'; complete(image, 640, 480)
  image.dispatchEvent(new Event('load'))
  expect(image.style.display).not.toBe('none')
  await metadata(bridge, 'https://example.org/page')
  jest.clearAllMocks(); image.click()
  expect(native.postToNativeBridge).toHaveBeenCalledTimes(1)
  expect(native.postToNativeBridge).toHaveBeenCalledWith(expect.objectContaining({type: 'imageClick', src: 'https://images.example.org/new.png', index: 0}))
})

test('social image links unwrap without replacing their image nodes', async () => {
  document.body.innerHTML = '<div><div class="social-post"><a href="https://example.org/post"><img src="https://images.example.org/photo.png"></a></div></div>'
  const image = document.querySelector('img')!
  new SlaxWebViewBridge(); await settle()
  expect(image.closest('a')).toBeNull()
  expect(document.querySelector('img')).toBe(image)
})
