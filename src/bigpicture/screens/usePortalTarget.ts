// Stremio Big Picture: find an element of the view on screen to render into, without
// changing upstream's components. Views render late, and some first render a placeholder
// copy of their layout while they load (Board's suspense fallback has the same nav bars),
// so the target is checked twice a second for as long as it's needed, and replaced when
// the one in use leaves the page.
// SPDX-License-Identifier: GPL-2.0-only

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

const POLL_MS = 500;

// The topmost route's element matching the selector; lower routes stay mounted but hidden.
const findInTopRoute = (selector: string): HTMLElement | null => {
    const view = document.querySelector('.routes-container')?.lastElementChild;
    return view?.querySelector<HTMLElement>(selector) ?? null;
};

const usePortalTarget = (selector: string, active: boolean) => {
    const location = useLocation();
    const [target, setTarget] = useState<HTMLElement | null>(null);
    useEffect(() => {
        if (!active) {
            setTarget(null);
            return;
        }
        const look = () => {
            const found = findInTopRoute(selector);
            setTarget((current) => (current === found ? current : found));
        };
        look();
        const timer = window.setInterval(look, POLL_MS);
        return () => window.clearInterval(timer);
    }, [selector, active, location.pathname]);
    return target;
};

export default usePortalTarget;
