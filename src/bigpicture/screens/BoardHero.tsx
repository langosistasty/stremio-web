// Stremio Big Picture: Board's hero. The focused title's backdrop fills the top of the
// screen, with its name, year, runtime, genres, rating and description; the rows sit
// below, and the focused row stays at a steady place under the hero, as TV apps do.
// It follows focus once it rests for a moment, so fast scrolling doesn't flicker or load
// every backdrop. Rendered into Board's own view, so upstream's Board is unchanged.
// SPDX-License-Identifier: GPL-2.0-only

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCore } from 'stremio/core';
import usePortalTarget from './usePortalTarget';

const REST_MS = 250;
// Room above the focused row, so its title isn't cut by the hero's edge.
const ROW_GAP_PX = 12;
const BOARD = '[class*="board-content-container-"]';
const ROWS = '[class*="board-content-"]:not([class*="board-content-container-"])';
const DETAIL = /#\/detail\/([^/]+)\/([^/?]+)/;

type Link = { name: string, category: string };
type Preview = {
    id: string,
    type: string,
    name: string,
    poster?: string | null,
    background?: string | null,
    description?: string | null,
    releaseInfo?: string | null,
    runtime?: string | null,
    links?: Link[],
};

type Transport = { getState: (model: string) => Promise<any> };

// The title behind a focused poster, from its link to the details page.
const focusedTitle = (element: Element | null) => {
    const link = element?.closest('a[href]')?.getAttribute('href') ?? '';
    const match = DETAIL.exec(link);
    return match ? { type: match[1], id: decodeURIComponent(match[2]) } : null;
};

// Board's catalogs hold each title's preview; Continue Watching's row holds library items.
const findPreview = async (transport: Transport, id: string): Promise<Preview | null> => {
    const board = await transport.getState('board').catch(() => null);
    for (const catalog of board?.catalogs ?? []) {
        const items: Preview[] = catalog?.content?.type === 'Ready' ? catalog.content.content : [];
        const item = items.find((candidate) => candidate.id === id);
        if (item) return item;
    }
    const watching = await transport.getState('continue_watching_preview').catch(() => null);
    const item = (watching?.items ?? []).find((candidate: { _id?: string, id?: string }) => (candidate._id ?? candidate.id) === id);
    return item ? { ...item, id } : null;
};

const facts = (preview: Preview) => {
    const genres = (preview.links ?? []).filter((link) => link.category === 'Genres').slice(0, 2).map((link) => link.name);
    const rating = (preview.links ?? []).find((link) => link.category === 'imdb')?.name;
    return [preview.releaseInfo, preview.runtime, ...genres, rating ? `★ ${rating}` : null]
        .filter((fact): fact is string => typeof fact === 'string' && fact.length > 0);
};

const BoardHero = ({ active }: { active: boolean }) => {
    const core = useCore() as { transport: Transport };
    const target = usePortalTarget(BOARD, active);
    const [preview, setPreview] = useState<Preview | null>(null);

    useEffect(() => {
        if (!target) return;
        let timer = 0;
        let request = 0;
        let shown = false;
        const show = () => {
            // With focus elsewhere (the rail), the hero keeps the last title; before any,
            // it shows Board's first, so the top of the screen is never empty.
            const focused = focusedTitle(document.activeElement);
            if (!focused && shown) return;
            const title = focused ?? focusedTitle(target.querySelector(`${ROWS} a[href*="#/detail/"]`));
            if (!title) return;
            const current = ++request;
            findPreview(core.transport, title.id).then((found) => {
                if (found && current === request) {
                    shown = true;
                    setPreview(found);
                }
            });
        };
        const onFocusIn = (event: FocusEvent) => {
            const element = event.target as HTMLElement;
            // The focused row stays just under the hero, as on TV apps.
            // Only the rows' own container scrolls: scrollIntoView would also scroll the
            // page (upstream's <html> scrolls) and carry the hero away. It's instant, so the
            // focus engine then finds the poster fully visible and doesn't scroll as well;
            // the hero's crossfade is the motion.
            const row = element.closest('[class*="meta-row-container-"]');
            const rows = target.querySelector<HTMLElement>(ROWS);
            if (row && rows?.contains(row)) {
                rows.scrollTop += row.getBoundingClientRect().top - rows.getBoundingClientRect().top - ROW_GAP_PX;
            }
            window.clearTimeout(timer);
            timer = window.setTimeout(show, REST_MS);
        };
        target.addEventListener('focusin', onFocusIn);
        show();
        // Posters arrive after the hero mounts; fill it once they do.
        const first = window.setInterval(() => {
            if (shown) window.clearInterval(first);
            else show();
        }, 500);
        return () => {
            target.removeEventListener('focusin', onFocusIn);
            window.clearTimeout(timer);
            window.clearInterval(first);
        };
    }, [target, core]);

    useEffect(() => {
        document.documentElement.toggleAttribute('data-bigpicture-hero', target !== null);
        return () => document.documentElement.removeAttribute('data-bigpicture-hero');
    }, [target]);

    if (!target) return null;
    const art = preview?.background || preview?.poster;
    return createPortal(
        <div className={'bigpicture-hero'} aria-hidden={true}>
            {
                art ?
                    <div key={art} className={'bigpicture-hero-art'} style={{ backgroundImage: `url("${art}")` }} />
                    :
                    null
            }
            {
                preview ?
                    <div key={preview.id} className={'bigpicture-hero-text'}>
                        <div className={'bigpicture-hero-title'}>{preview.name}</div>
                        <div className={'bigpicture-hero-facts'}>
                            {facts(preview).map((fact) => <span key={fact}>{fact}</span>)}
                        </div>
                        {
                            preview.description ?
                                <div className={'bigpicture-hero-description'}>{preview.description}</div>
                                :
                                null
                        }
                    </div>
                    :
                    null
            }
        </div>,
        target,
    );
};

export default BoardHero;
