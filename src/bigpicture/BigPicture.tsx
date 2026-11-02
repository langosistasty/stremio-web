// Stremio Big Picture: applies the mode's global effects.
// SPDX-License-Identifier: GPL-2.0-only

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useFullscreen, usePlatform } from 'stremio/common';
import { useGoBack } from 'stremio/router';
import { useBigPicture } from './store';
import { FocusEngine, installStyles, startPromoting } from './focus';

// Rendered once inside FullscreenProvider and the router; draws nothing.
const BigPicture = () => {
    const { enabled } = useBigPicture();
    const { shell } = usePlatform();
    const [, requestFullscreen] = useFullscreen();
    const location = useLocation();
    const navigationType = useNavigationType();
    const goBack = useGoBack();

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

    const goBackRef = useRef(goBack);
    goBackRef.current = goBack;
    const engineRef = useRef<FocusEngine | null>(null);
    const navigation = { entry: location.key, type: navigationType, path: location.pathname };
    const navigationRef = useRef(navigation);
    navigationRef.current = navigation;

    // Before the router's own layout effect swaps the views, so the engine knows
    // which history entry a new view belongs to.
    useLayoutEffect(() => {
        engineRef.current?.setNavigation(navigationRef.current);
    }, [location, navigationType]);

    useEffect(() => {
        if (!enabled) return;
        installStyles();
        const engine = new FocusEngine(() => goBackRef.current());
        engine.setNavigation(navigationRef.current);
        engineRef.current = engine;
        const stopEngine = engine.start();
        const stopPromoting = startPromoting();
        return () => {
            stopPromoting();
            stopEngine();
            engineRef.current = null;
        };
    }, [enabled]);

    return null;
};

export default BigPicture;
