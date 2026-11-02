// Stremio Big Picture: whether the 10-foot TV mode is on.
// SPDX-License-Identifier: GPL-2.0-only

// The setting lives in localStorage because stremio-core's Settings schema is fixed.
const STORAGE_KEY = 'bigPicture';
const PARAM = 'bigpicture';
const ON = new Set(['', '1', 'true', 'on', 'yes']);
const OFF = new Set(['0', 'false', 'off', 'no']);

// `?bigpicture=1` before the hash (what a launcher passes) or inside it (`#/?bigpicture=1`).
// The last value wins; anything unrecognised is ignored.
const readLaunchFlag = (): boolean | null => {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    const value = [
        ...new URLSearchParams(window.location.search).getAll(PARAM),
        ...new URLSearchParams(hashQuery).getAll(PARAM),
    ].pop()?.toLowerCase();

    if (value === undefined) return null;
    if (ON.has(value)) return true;
    if (OFF.has(value)) return false;
    return null;
};

const readStored = (): boolean => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
};

const writeStored = (enabled: boolean) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch (_) {
        // Private mode or blocked storage: the choice lasts for this session only.
    }
};

// A launch flag applies to this session and leaves the saved setting alone, so a
// TV launcher can force Big Picture without changing how a normal launch looks.
const initialEnabled = (): boolean => readLaunchFlag() ?? readStored();

export { initialEnabled, readLaunchFlag, writeStored };
