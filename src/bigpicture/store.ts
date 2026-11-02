// Stremio Big Picture: whether the mode is on, readable anywhere.
// A leaf module: upstream files import it, so it must not import the app back.
// SPDX-License-Identifier: GPL-2.0-only

import { useSyncExternalStore } from 'react';
import { initialEnabled, writeStored } from './flag';

// A module-level store rather than a context provider, so upstream's provider tree
// needs no re-indented wrapper and rebases stay small.
let enabled = initialEnabled();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const setEnabled = (value: boolean) => {
    enabled = value;
    writeStored(value);
    listeners.forEach((listener) => listener());
};

// For code outside React hooks, such as key handlers.
const isBigPictureEnabled = () => enabled;

const useBigPicture = () => ({
    enabled: useSyncExternalStore(subscribe, () => enabled),
    setEnabled,
});

export { isBigPictureEnabled, useBigPicture };
