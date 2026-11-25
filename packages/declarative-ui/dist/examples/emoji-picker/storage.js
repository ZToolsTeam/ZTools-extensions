const PINNED_STORAGE_KEY = "ztools_emoji_pinned_v1";
const memoryPinned = new Set(["👍", "❤️", "🚀", "💻", "🔥"]);
export async function getPinnedEmojis() {
    if (typeof localStorage !== "undefined") {
        try {
            const data = localStorage.getItem(PINNED_STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        }
        catch {
            // ignore JSON / storage errors
        }
    }
    return Array.from(memoryPinned);
}
export async function savePinnedEmojis(pinned) {
    memoryPinned.clear();
    pinned.forEach(c => memoryPinned.add(c));
    if (typeof localStorage !== "undefined") {
        try {
            localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned));
        }
        catch {
            // storage quota or blocked
        }
    }
}
export async function togglePinnedEmoji(char) {
    const current = await getPinnedEmojis();
    const exists = current.includes(char);
    let updated;
    if (exists) {
        updated = current.filter(c => c !== char);
    }
    else {
        updated = [char, ...current];
    }
    await savePinnedEmojis(updated);
    return !exists;
}
export async function isEmojiPinned(char) {
    const current = await getPinnedEmojis();
    return current.includes(char);
}
