import { initImageClickHandlers } from '../../src/features/images';
import * as nativeBridge from '../../src/bridge/native-bridge';

function createImg(src: string, naturalWidth = 0, naturalHeight = 0): HTMLImageElement {
    const img = document.createElement('img');
    img.src = src;
    Object.defineProperty(img, 'naturalWidth', { get: () => naturalWidth, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { get: () => naturalHeight, configurable: true });
    return img;
}

describe('图片功能 (Images Feature)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.spyOn(nativeBridge, 'postToNativeBridge');
    });

    test('应该处理图片点击', () => {
        const img1 = document.createElement('img');
        img1.src = 'https://example.com/1.jpg';
        document.body.appendChild(img1);

        const img2 = document.createElement('img');
        img2.src = 'https://example.com/2.jpg';
        document.body.appendChild(img2);

        initImageClickHandlers();

        img2.click();

        expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
            type: 'imageClick',
            src: 'https://example.com/2.jpg',
            allImages: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
            index: 1
        });
    });

    test('应该忽略非 http 图片', () => {
        const img1 = document.createElement('img');
        img1.src = 'data:image/png;base64,...';
        document.body.appendChild(img1);

        const img2 = document.createElement('img');
        img2.src = 'https://example.com/valid.jpg';
        document.body.appendChild(img2);

        initImageClickHandlers();

        img2.click();

        expect(nativeBridge.postToNativeBridge).toHaveBeenCalledWith({
            type: 'imageClick',
            src: 'https://example.com/valid.jpg',
            allImages: ['https://example.com/valid.jpg'], // data uri 被忽略
            index: 0
        });
    });

    describe('handleImageLoading', () => {
        test('应该清空 srcset 并添加 loading 类', () => {
            const img = createImg('https://example.com/1.jpg');
            img.srcset = 'https://example.com/1x.jpg 1x';
            document.body.appendChild(img);

            initImageClickHandlers();

            expect(img.srcset).toBe('');
            expect(img.classList.contains('slax-image-loading')).toBe(true);
        });

        test('应该清空 referrerPolicy', () => {
            const img = createImg('https://example.com/1.jpg');
            img.referrerPolicy = 'no-referrer';
            document.body.appendChild(img);

            initImageClickHandlers();

            expect(img.referrerPolicy).toBe('');
        });

        test('onload: 尺寸过小的图片应隐藏', () => {
            const img = createImg('https://example.com/tiny.jpg', 3, 3);
            document.body.appendChild(img);

            initImageClickHandlers();
            img.onload!(new Event('load'));

            expect(img.classList.contains('slax-image-loading')).toBe(false);
            expect(img.getAttribute('style')).toBe('display: none;');
        });

        test('onload: 宽度小于 200 的图片应设置固定宽度', () => {
            const img = createImg('https://example.com/small.jpg', 100, 80);
            document.body.appendChild(img);

            initImageClickHandlers();
            img.onload!(new Event('load'));

            expect(img.getAttribute('style')).toBe('width: 100px !important;');
        });

        test('onload: 正常尺寸图片应设置 padding 和 height 样式', () => {
            const img = createImg('https://example.com/normal.jpg', 400, 300);
            document.body.appendChild(img);

            initImageClickHandlers();
            img.onload!(new Event('load'));

            expect(img.getAttribute('style')).toBe('height: auto !important;');
        });

        test('onerror: 应移除 loading 类并隐藏图片', () => {
            const img = createImg('https://example.com/broken.jpg');
            document.body.appendChild(img);

            initImageClickHandlers();
            img.onerror!(new Event('error'));

            expect(img.classList.contains('slax-image-loading')).toBe(false);
            expect(img.style.display).toBe('none');
        });

        test('父元素只含图片时应清除 float', () => {
            const wrapper = document.createElement('div');
            const img1 = createImg('https://example.com/a.jpg');
            const img2 = createImg('https://example.com/b.jpg');
            img1.style.cssFloat = 'left';
            wrapper.appendChild(img1);
            wrapper.appendChild(img2);
            document.body.appendChild(wrapper);

            initImageClickHandlers();

            expect(img1.style.cssFloat).toBe('none');
        });

        test('父元素含非图片子节点时不应清除 float', () => {
            const wrapper = document.createElement('div');
            const img = createImg('https://example.com/a.jpg');
            img.style.cssFloat = 'left';
            const span = document.createElement('span');
            wrapper.appendChild(img);
            wrapper.appendChild(span);
            document.body.appendChild(wrapper);

            initImageClickHandlers();

            expect(img.style.cssFloat).toBe('left');
        });
    });

    describe('unwrapImgAnchorsInTweet', () => {
        function setupTweetBody(innerHTML: string) {
            const div = document.createElement('div');
            div.className = 'tweet';
            div.innerHTML = innerHTML;
            document.body.appendChild(div);
        }

        test('tweet 内容中 a 标签包裹的 img 应被解包', () => {
            setupTweetBody('<a href="https://t.co/x"><img src="https://example.com/photo.jpg"></a>');

            initImageClickHandlers();

            const tweetDiv = document.body.querySelector('.tweet')!;
            expect(tweetDiv.querySelector('a')).toBeNull();
            expect(tweetDiv.querySelector('img')).not.toBeNull();
        });

        test('解包后 a 标签内的其他子节点也应保留', () => {
            setupTweetBody('<a href="https://t.co/x"><img src="https://example.com/photo.jpg"><span>caption</span></a>');

            initImageClickHandlers();

            const tweetDiv = document.body.querySelector('.tweet')!;
            expect(tweetDiv.querySelector('a')).toBeNull();
            expect(tweetDiv.querySelector('img')).not.toBeNull();
            expect(tweetDiv.querySelector('span')).not.toBeNull();
        });

        test('多个 a img 都应被解包', () => {
            setupTweetBody(`
                <a href="https://t.co/1"><img src="https://example.com/1.jpg"></a>
                <a href="https://t.co/2"><img src="https://example.com/2.jpg"></a>
            `);

            initImageClickHandlers();

            const tweetDiv = document.body.querySelector('.tweet')!;
            expect(tweetDiv.querySelectorAll('a').length).toBe(0);
            expect(tweetDiv.querySelectorAll('img').length).toBe(2);
        });

        test('非 tweet 内容中的 a img 不应被解包', () => {
            const div = document.createElement('div');
            div.className = 'article';
            div.innerHTML = '<a href="https://example.com"><img src="https://example.com/photo.jpg"></a>';
            document.body.appendChild(div);

            initImageClickHandlers();

            expect(div.querySelector('a')).not.toBeNull();
            expect(div.querySelector('img')).not.toBeNull();
        });

        test('body 下第一个 div 没有 tweet class 时不处理', () => {
            const div = document.createElement('div');
            div.className = 'post';
            div.innerHTML = '<a href="https://example.com"><img src="https://example.com/photo.jpg"></a>';
            document.body.appendChild(div);

            initImageClickHandlers();

            expect(div.querySelector('a')).not.toBeNull();
        });

        test('不含 img 的 a 标签不应被影响', () => {
            setupTweetBody('<a href="https://t.co/x">just text</a><img src="https://example.com/photo.jpg">');

            initImageClickHandlers();

            const tweetDiv = document.body.querySelector('.tweet')!;
            expect(tweetDiv.querySelector('a')).not.toBeNull();
            expect(tweetDiv.querySelector('a')!.textContent).toBe('just text');
        });
    });
});
