import { MarkManager } from '../../src/features/mark-manager';
import type { MarkDetail } from '../../src/types/selection';

function createContainer(): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
}

function buildMarkDetail(overrides: Partial<MarkDetail> = {}): MarkDetail {
    return {
        mark_list: [],
        user_list: {},
        ...overrides,
    };
}

describe('MarkManager', () => {
    let container: HTMLElement;
    let manager: MarkManager;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = createContainer();
        manager = new MarkManager(container, 1);
    });

    describe('drawMarks', () => {
        test('空数据应返回空对象', () => {
            const result = manager.drawMarks(buildMarkDetail());
            expect(result).toEqual({});
        });

        test('LINE 类型 mark 应被渲染并返回 uuid 映射', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 101,
                        user_id: 1,
                        type: 1, // LINE
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 0,
                        comment: '',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            const result = manager.drawMarks(detail);

            const uuids = Object.keys(result);
            expect(uuids.length).toBe(1);
            expect(result[uuids[0]].length).toBe(1);
            expect(result[uuids[0]][0].id).toBe(101);

            // DOM 中应有 slax-mark
            expect(container.querySelector('slax-mark')).not.toBeNull();
        });

        test('COMMENT 类型 mark 应被渲染', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 201,
                        user_id: 1,
                        type: 2, // COMMENT
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 0,
                        comment: 'nice',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            const result = manager.drawMarks(detail);
            const uuids = Object.keys(result);
            expect(uuids.length).toBe(1);
        });

        test('相同 source 的 LINE 和 COMMENT 应合并为同一 uuid', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const sharedSource = [{ type: 'text' as const, path: 'p', start: 0, end: 5 }];

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 301,
                        user_id: 1,
                        type: 1, // LINE
                        source: sharedSource,
                        parent_id: 0,
                        root_id: 0,
                        comment: '',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                    {
                        id: 302,
                        user_id: 1,
                        type: 2, // COMMENT
                        source: sharedSource,
                        parent_id: 0,
                        root_id: 0,
                        comment: 'great',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            const result = manager.drawMarks(detail);
            const uuids = Object.keys(result);
            expect(uuids.length).toBe(1);
            expect(result[uuids[0]].length).toBe(2);
        });

        test('REPLY 类型 mark 不应单独生成 uuid', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 401,
                        user_id: 1,
                        type: 2, // COMMENT (root)
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 401,
                        comment: 'root comment',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                    {
                        id: 402,
                        user_id: 1,
                        type: 3, // REPLY
                        source: 401, // numeric source
                        parent_id: 401,
                        root_id: 401,
                        comment: 'reply',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            const result = manager.drawMarks(detail);
            const uuids = Object.keys(result);
            // REPLY 不单独生成 uuid，只有 COMMENT 的 uuid
            expect(uuids.length).toBe(1);
        });
    });

    describe('removeMarkByUuid', () => {
        test('应移除指定 uuid 的 mark', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world';
            container.appendChild(p);

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 501,
                        user_id: 1,
                        type: 1,
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 0,
                        comment: '',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            const result = manager.drawMarks(detail);
            const uuid = Object.keys(result)[0];

            expect(container.querySelector('slax-mark')).not.toBeNull();
            manager.removeMarkByUuid(uuid);
            expect(container.querySelector('slax-mark')).toBeNull();
        });
    });

    describe('clearAllMarks', () => {
        test('应清除所有 mark', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world foo';
            container.appendChild(p);

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 601,
                        user_id: 1,
                        type: 1,
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 0,
                        comment: '',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            manager.drawMarks(detail);
            manager.clearAllMarks();

            expect(container.querySelectorAll('slax-mark').length).toBe(0);
        });
    });

    describe('getAllMarkIds', () => {
        test('应返回所有已渲染的 mark uuid', () => {
            const p = document.createElement('p');
            p.textContent = 'hello world foo';
            container.appendChild(p);

            const detail: MarkDetail = {
                user_list: { '1': { user_id: 1, username: 'Alice', avatar: '' } },
                mark_list: [
                    {
                        id: 701,
                        user_id: 1,
                        type: 1,
                        source: [{ type: 'text', path: 'p', start: 0, end: 5 }],
                        parent_id: 0,
                        root_id: 0,
                        comment: '',
                        created_at: new Date(),
                        is_deleted: false,
                    },
                ],
            };

            manager.drawMarks(detail);
            const ids = manager.getAllMarkIds();
            expect(ids.length).toBe(1);
        });
    });
});
