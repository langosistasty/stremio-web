// Stremio Big Picture: the mode's state, readable anywhere, and its global effects.
// SPDX-License-Identifier: GPL-2.0-only

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFullscreen, usePlatform } from 'stremio/common';
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

const useBigPicture = () => ({
    enabled: useSyncExternalStore(subscribe, () => enabled),
    setEnabled,
});

// Rendered once inside FullscreenProvider; draws nothing.
const BigPicture = () => {
    const { enabled } = useBigPicture();
    const { shell } = usePlatform();
    const [, requestFullscreen] = useFullscreen();

    // Styles and later phases key off this attribute; nothing changes while it is absent.
    useEffect(() => {
        document.documentElement.toggleAttribute('data-bigpicture', enabled);
    }, [enabled]);

    // Go fullscreen once per switch-on. requestFullscreen changes identity whenever the
    // shell state does, and the shell answers with a state change, so keep it in a ref.
    const requestFullscreenRef = useRef(requestFullscreen);
    requestFullscreenRef.current = requestFullscreen;
    const shellReady = shell.active && shell.state.initialized;
    useEffect(() => {
        // Browsers only allow fullscreen from a user gesture, so this is for the shell.
        if (enabled && shellReady) {
            requestFullscreenRef.current();
        }
    }, [enabled, shellReady]);

    return null;
};

export { BigPicture, useBigPicture };
