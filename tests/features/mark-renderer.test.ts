import { MarkRenderer } from '../../src/features/mark-renderer';

function createContainer(): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
}

describe('MarkRenderer', () => {
    let container: HTMLElement;
    let renderer: MarkRenderer;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = createContainer();
        renderer = new MarkRenderer(container, 1);
    });

    describe('drawMark - 文本', () => {
        test('应在文本节点上创建 slax-mark 元素', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const success = renderer.drawMark(
                'uuid-1',
                [{ type: 'text', path: 'p', start: 0, end: 5 }],
                true,
                false
            );

            expect(success).toBe(true);
            const mark = container.querySelector('slax-mark[data-uuid="uuid-1"]');
            expect(mark).not.toBeNull();
            expect(mark?.textContent).toBe('hello');
        });

        test('isStroke=true 应添加 stroke class', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-2', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-2"]');
            expect(mark?.classList.contains('stroke')).toBe(true);
            expect(mark?.classList.contains('comment')).toBe(false);
        });

        test('hasComment=true 应添加 comment class', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-3', [{ type: 'text', path: 'p', start: 0, end: 5 }], false, true);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-3"]');
            expect(mark?.classList.contains('comment')).toBe(true);
        });

        test('当前用户的 mark 应添加 self-stroke class', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-4', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false, 1);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-4"]');
            expect(mark?.classList.contains('self-stroke')).toBe(true);
        });

        test('其他用户的 mark 不应添加 self-stroke class', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-5', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false, 99);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-5"]');
            expect(mark?.classList.contains('self-stroke')).toBe(false);
        });

        test('路径不存在时应返回 false', () => {
            const success = renderer.drawMark(
                'uuid-6',
                [{ type: 'text', path: 'nonexistent', start: 0, end: 5 }],
                true,
                false
            );
            expect(success).toBe(false);
        });

        test('isStroke 和 hasComment 均为 false 时不渲染', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-7', [{ type: 'text', path: 'p', start: 0, end: 5 }], false, false);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-7"]');
            expect(mark).toBeNull();
        });
    });

    describe('updateMark', () => {
        test('应更新 mark 的 class', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-u1', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            renderer.updateMark('uuid-u1', true, true);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-u1"]');
            expect(mark?.classList.contains('stroke')).toBe(true);
            expect(mark?.classList.contains('comment')).toBe(true);
        });

        test('isStroke 和 hasComment 均为 false 时应移除 mark 元素', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-u2', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            renderer.updateMark('uuid-u2', false, false);

            const mark = container.querySelector('slax-mark[data-uuid="uuid-u2"]');
            expect(mark).toBeNull();
        });
    });

    describe('removeMark', () => {
        test('应移除指定 uuid 的 mark 元素', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-r1', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            expect(container.querySelector('slax-mark[data-uuid="uuid-r1"]')).not.toBeNull();

            renderer.removeMark('uuid-r1');
            expect(container.querySelector('slax-mark[data-uuid="uuid-r1"]')).toBeNull();
            expect(p.textContent).toBe('hello world'); // 文本内容应保留
        });
    });

    describe('highlightMark', () => {
        test('应添加 highlighted class 并清除其他高亮', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world foo bar';
            container.appendChild(p);

            renderer.drawMark('uuid-h1', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            renderer.drawMark('uuid-h2', [{ type: 'text', path: 'p', start: 6, end: 11 }], true, false);

            renderer.highlightMark('uuid-h1');
            expect(container.querySelector('slax-mark[data-uuid="uuid-h1"]')?.classList.contains('highlighted')).toBe(true);

            renderer.highlightMark('uuid-h2');
            // uuid-h1 的高亮应被清除
            expect(container.querySelector('slax-mark[data-uuid="uuid-h1"]')?.classList.contains('highlighted')).toBe(false);
            expect(container.querySelector('slax-mark[data-uuid="uuid-h2"]')?.classList.contains('highlighted')).toBe(true);
        });
    });

    describe('clearAllHighlights', () => {
        test('应清除所有 highlighted class', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-c1', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            renderer.highlightMark('uuid-c1');
            renderer.clearAllHighlights();

            const marks = container.querySelectorAll('slax-mark.highlighted');
            expect(marks.length).toBe(0);
        });
    });

    describe('clearAllMarks', () => {
        test('应移除所有 slax-mark 元素并保留文本', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            renderer.drawMark('uuid-ca1', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            renderer.clearAllMarks();

            expect(container.querySelectorAll('slax-mark').length).toBe(0);
            expect(p.textContent).toBe('hello world');
        });
    });

    describe('getAllMarkIds', () => {
        test('应返回所有唯一的 mark uuid', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world foo';
            container.appendChild(p);

            renderer.drawMark('uuid-g1', [{ type: 'text', path: 'p', start: 0, end: 5 }], true, false);
            renderer.drawMark('uuid-g2', [{ type: 'text', path: 'p', start: 6, end: 11 }], true, false);

            const ids = renderer.getAllMarkIds();
            expect(ids).toContain('uuid-g1');
            expect(ids).toContain('uuid-g2');
            expect(ids.length).toBe(2);
        });
    });
});
