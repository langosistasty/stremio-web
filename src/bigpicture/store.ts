// Stremio Big Picture: the mode and its layout settings, readable anywhere.
// A leaf module: upstream files import it, so it must not import the app back.
// SPDX-License-Identifier: GPL-2.0-only

import { useSyncExternalStore } from 'react';
import { initialEnabled, writeStored } from './flag';

// TV size multiplies upstream's interface scale: 150% gives a 1080p TV the layout of a
// 1280x720 screen, which reads well from about 3 m.
const TV_SCALES = [100, 125, 150, 175, 200];
const DEFAULT_TV_SCALE = 150;
// Safe margin for TVs that crop the picture's edges (overscan), in percent per side.
const OVERSCAN_MARGINS = [0, 2.5, 5];

type State = {
    enabled: boolean,
    tvScale: number,
    overscan: number,
};

const readNumber = (key: string, allowed: number[], fallback: number) => {
    try {
        const value = Number(window.localStorage.getItem(key));
        return allowed.includes(value) ? value : fallback;
    } catch (_) {
        return fallback;
    }
};

const writeNumber = (key: string, value: number) => {
    try {
        window.localStorage.setItem(key, String(value));
    } catch (_) {
        // Blocked storage: the choice lasts for this session only.
    }
};

// A module-level store rather than a context provider, so upstream's provider tree
// needs no re-indented wrapper and rebases stay small.
let state: State = {
    enabled: initialEnabled(),
    tvScale: readNumber('bigPictureScale', TV_SCALES, DEFAULT_TV_SCALE),
    overscan: readNumber('bigPictureOverscan', OVERSCAN_MARGINS, 0),
};
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const update = (changes: Partial<State>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
};

const setEnabled = (enabled: boolean) => {
    writeStored(enabled);
    update({ enabled });
};

const setTvScale = (tvScale: number) => {
    writeNumber('bigPictureScale', tvScale);
    update({ tvScale });
};

const setOverscan = (overscan: number) => {
    writeNumber('bigPictureOverscan', overscan);
    update({ overscan });
};

// For code outside React hooks, such as key handlers.
const isBigPictureEnabled = () => state.enabled;

const useBigPicture = () => ({
    enabled: useSyncExternalStore(subscribe, () => state.enabled),
    setEnabled,
});

const useBigPictureLayout = () => ({
    ...useSyncExternalStore(subscribe, () => state),
    setTvScale,
    setOverscan,
});

export { OVERSCAN_MARGINS, TV_SCALES, isBigPictureEnabled, useBigPicture, useBigPictureLayout };
