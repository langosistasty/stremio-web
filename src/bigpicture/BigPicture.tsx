// Stremio Big Picture: applies the mode's global effects.
// SPDX-License-Identifier: GPL-2.0-only

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { useFullscreen, usePlatform } from 'stremio/common';
import { useGoBack } from 'stremio/router';
import { useBigPictureLayout } from './store';
import { FocusEngine, installStyles, startPromoting } from './focus';
import installTheme from './theme';
import startDiagnostics from './diagnostics';
import startSoak from './soak';
import startGamepads from './input/gamepad';
import { startKeyboardTracking } from './input/keyboard';
import { closeQuitDialog, openQuitDialog } from './input/quit';
import BoardHero from './screens/BoardHero';
import RailSearch from './screens/RailSearch';

startDiagnostics();
startSoak();

// Rendered once inside FullscreenProvider and the router. It draws only into the views on
// screen, through portals: Board's hero and the rail's Search tab.
const BigPicture = () => {
    const { enabled, overscan } = useBigPictureLayout();
    const { shell } = usePlatform();
    const [, requestFullscreen] = useFullscreen();
    const location = useLocation();
    const navigationType = useNavigationType();
    const goBack = useGoBack();
    const navigate = useNavigate();

    // Styles and later phases key off this attribute; nothing changes while it is absent.
    useEffect(() => {
        document.documentElement.toggleAttribute('data-bigpicture', enabled);
    }, [enabled]);

    useEffect(() => {
        document.documentElement.style.setProperty('--bigpicture-overscan', String(overscan));
    }, [overscan]);

    // Go fullscreen once per switch-on. requestFullscreen changes identity whenever the
    // shell state does, and the shell answers with a state change, so keep it in a ref.
    const requestFullscreenRef = useRef(requestFullscreen);
    requestFullscreenRef.current = requestFullscreen;
    const shellReady = shell.active && shell.state.initialized;
    const shellRef = useRef(shell);
    shellRef.current = shell;
    useEffect(() => {
        // Browsers only allow fullscreen from a user gesture, so this is for the shell.
        if (enabled && shellReady) {
            requestFullscreenRef.current();
        }
    }, [enabled, shellReady]);

    const goBackRef = useRef(goBack);
    goBackRef.current = goBack;
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;
    const engineRef = useRef<FocusEngine | null>(null);
    const navigation = { entry: location.key, type: navigationType, path: location.pathname, search: location.search };
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
        installTheme();
        // Quitting needs the shell; in a browser, Back on Board does nothing.
        const onHomeBack = () => {
            if (shellRef.current.active) openQuitDialog(() => shellRef.current.send('quit'));
        };
        const engine = new FocusEngine(() => goBackRef.current(), (to, options) => navigateRef.current(to, options), onHomeBack);
        engine.setNavigation(navigationRef.current);
        engineRef.current = engine;
        const stopEngine = engine.start();
        const stopPromoting = startPromoting();
        const stopGamepads = startGamepads();
        const stopKeyboard = startKeyboardTracking();
        return () => {
            closeQuitDialog();
            stopKeyboard();
            stopGamepads();
            stopPromoting();
            stopEngine();
            engineRef.current = null;
        };
    }, [enabled]);

    return (
        <>
            <BoardHero active={enabled} />
            <RailSearch active={enabled} />
        </>
    );
};

export default BigPicture;
