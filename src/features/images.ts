import { postToNativeBridge } from '../bridge/native-bridge';

/**
 * 获取图片元素的 URL
 */
function getImageUrl(element: Element): string {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'img') {
        const img = element as HTMLImageElement;
        return img.currentSrc || img.src || '';
    }

    if (tagName === 'image') {
        const svgImage = element as SVGImageElement;
        return svgImage.href?.baseVal ||
               element.getAttribute('href') ||
               element.getAttribute('xlink:href') ||
               '';
    }

    return '';
}

/**
 * 处理图片加载和样式
 */
function handleImageLoading(imgs: HTMLImageElement[]) {
    const loadingKey = 'slax-image-loading';

    imgs.forEach(img => {
        img.srcset = '';

        img.onload = () => {
            img.classList.remove(loadingKey);

            if (img.naturalWidth < 5 || img.naturalHeight < 5) {
                img.setAttribute('style', 'display: none;');
                return;
            } else if (img.naturalWidth < 200) {
                img.setAttribute('style', `width: ${img.naturalWidth}px !important;`);
                return;
            }

            ['padding: 0 !important', 'height: auto !important;'].forEach(style => {
                img.setAttribute('style', style);
            });
        };

        img.referrerPolicy = '';

        img.onerror = () => {
            img.classList.remove(loadingKey);
            img.style.display = 'none';
        };

        img.classList.add(loadingKey);

        const parentElement = img.parentElement;
        const parentChilds = parentElement ? Array.from(parentElement.childNodes) : [];

        const isOnlyImages = parentChilds.every(child => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const element = child as HTMLElement;
                return element.tagName.toLowerCase() === 'img';
            }
            return true;
        });

        if (isOnlyImages) {
            img.style.cssFloat = 'none';
        }
    });
}

/**
 * 初始化图片点击处理程序
 */
export function initImageClickHandlers() {
    const images = document.querySelectorAll('img, image');
    const htmlImages = Array.from(images).filter(img => img.tagName.toLowerCase() === 'img') as HTMLImageElement[];

    handleImageLoading(htmlImages);

    images.forEach(img => {
        img.addEventListener('click', (event) => {
            const validSchemes = ['https://', 'http://', 'slaxstatics://', 'slaxstatic://'];
            const allImageUrls = Array.from(images)
                .map(getImageUrl)
                .filter(url => url && validSchemes.some(scheme => url.startsWith(scheme)));

            const currentTarget = event.currentTarget as Element;
            const clickedImageUrl = getImageUrl(currentTarget);

            postToNativeBridge({
                type: 'imageClick',
                src: clickedImageUrl,
                allImages: allImageUrls,
                index: allImageUrls.indexOf(clickedImageUrl)
            });
        });
    });

    console.log(`[WebView Bridge] Initialized ${images.length} image click handlers`);
}
