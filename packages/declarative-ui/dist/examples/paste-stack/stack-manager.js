import { callHostTransport } from '../shared/native-ipc.js';
export function cleanRichTextToPlain(rawInput) {
    const input = String(rawInput || '');
    if (!input)
        return '';
    let text = input
        // Strip RTF control blocks if RTF header present
        .replace(/^\{\\rtf1[\s\S]*?\\pard\s*/i, '')
        .replace(/\\[a-z]+\d*\s?/gi, '')
        // Strip HTML style/script blocks completely
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        // Convert block-level closing tags to newlines if needed, or strip inline tags cleanly
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        // Decode common HTML entities
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        // Normalize CRLF
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Compress 3+ consecutive newlines to at most 1 blank line (2 newlines)
        .replace(/\n{3,}/g, '\n\n');
    // Trim each line's trailing spaces and overall leading/trailing whitespace
    text = text
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();
    return text;
}
export async function readClipboardWithRetry(reader, options) {
    const maxRetries = options?.maxRetries ?? 3;
    const baseDelayMs = options?.baseDelayMs ?? 15;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await reader();
        }
        catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw new Error(`CLIPBOARD_LOCKED: 剪贴板被其他软件占用且重试 ${maxRetries} 次失败 (${lastError instanceof Error ? lastError.message : String(lastError)})`);
}
export class PasteStackQueueManager {
    #items = [];
    #listening = true;
    constructor(initialItems = []) {
        this.#items = [...initialItems];
    }
    getItems() {
        return [...this.#items];
    }
    isListening() {
        return this.#listening;
    }
    setListening(enabled) {
        this.#listening = Boolean(enabled);
    }
    push(rawText, sourceApp = '系统剪贴板', nowMs = Date.now()) {
        const cleaned = cleanRichTextToPlain(rawText);
        if (!cleaned) {
            return { added: false, deduplicated: false };
        }
        const last = this.#items[this.#items.length - 1];
        if (last && last.text === cleaned) {
            return { added: false, deduplicated: true, item: last };
        }
        const item = {
            id: `stk-${nowMs}-${this.#items.length + 1}`,
            text: cleaned,
            textPreview: cleaned.replace(/\s+/g, ' ').slice(0, 60),
            charCount: cleaned.length,
            timestamp: nowMs,
            timeAgo: '刚刚',
            sourceApp
        };
        this.#items.push(item);
        return { added: true, deduplicated: false, item };
    }
    pop(mode = 'fifo', itemId) {
        if (this.#items.length === 0) {
            return {
                ok: false,
                remainingCount: 0,
                errorCode: 'STACK_EMPTY',
                error: 'STACK_EMPTY: 粘贴栈为空，无法执行出栈'
            };
        }
        let popped;
        if (itemId) {
            const idx = this.#items.findIndex((i) => i.id === itemId);
            if (idx >= 0) {
                popped = this.#items.splice(idx, 1)[0];
            }
        }
        if (!popped) {
            popped = mode === 'lifo' ? this.#items.pop() : this.#items.shift();
        }
        return {
            ok: true,
            popped,
            remainingCount: this.#items.length
        };
    }
    move(fromIndex, toIndex) {
        if (fromIndex < 0 ||
            fromIndex >= this.#items.length ||
            toIndex < 0 ||
            toIndex >= this.#items.length ||
            fromIndex === toIndex) {
            return this.getItems();
        }
        const [moved] = this.#items.splice(fromIndex, 1);
        if (moved) {
            this.#items.splice(toIndex, 0, moved);
        }
        return this.getItems();
    }
    remove(itemId) {
        this.#items = this.#items.filter((i) => i.id !== itemId);
        return this.getItems();
    }
    clear() {
        this.#items = [];
    }
}
export async function fetchHostPasteStackState(hostOverride) {
    const res = await callHostTransport('dllplugin_call', {
        plugin: 'PasteStackPlugin',
        func: 'getState',
        params: {}
    }, hostOverride);
    if (!res.ok || !res.data) {
        throw new Error(res.error || 'PASTESTACK_STATE_FAILED: 无法读取粘贴栈状态');
    }
    return {
        isListening: Boolean(res.data.isListening ?? true),
        items: (res.data.items || []).map((item) => ({
            ...item,
            timeAgo: item.timeAgo || '刚刚'
        }))
    };
}
