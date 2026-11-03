// Stremio Big Picture: a fake Stremio account, so Library, Continue Watching and
// Calendar can be tested offline. The Stremio API answers from here; the account's
// library holds series and movies, some half watched, and the series have episodes
// spread over the months around today, the way Calendar shows them.
// SPDX-License-Identifier: GPL-2.0-only

import type { BrowserContext, Route } from '@playwright/test';
import { POSTER_HOST } from './catalog';

const USER = {
    _id: 'e2euser', email: 'tv@e2e.invalid', fbId: null, avatar: null,
    lastModified: '2026-01-01T00:00:00.000Z', dateRegistered: '2026-01-01T00:00:00.000Z',
    trakt: null, premium_expire: null,
    gdpr_consent: { tos: true, privacy: true, marketing: false, from: 'web' },
};

type Library = { series: number, movies: number, watching: number };
const DEFAULT_LIBRARY: Library = { series: 30, movies: 20, watching: 8 };

const libraryId = (type: string, index: number) => `ttlib${type}${index + 1}`;
const libraryName = (type: string, index: number) => `${type} library ${index + 1}`;

const DAY_MS = 24 * 60 * 60 * 1000;

// Each series airs weekly, on its own weekday, from four months back to two ahead.
const episodes = (id: string, index: number, now: number) => Array.from({ length: 26 }, (_, week) => {
    const released = new Date(now + ((week - 17) * 7 + (index % 7)) * DAY_MS);
    return { id: `${id}:1:${week + 1}`, title: `Episode ${week + 1}`, season: 1, episode: week + 1, released: released.toISOString() };
});

const libraryItem = (type: string, index: number, watching: boolean, now: number) => {
    const id = libraryId(type, index);
    const name = libraryName(type, index);
    const stamp = new Date(now - (index + 1) * 60 * 60 * 1000).toISOString();
    return {
        _id: id, name, type,
        poster: `${POSTER_HOST}/${encodeURIComponent(name)}.svg`,
        posterShape: 'poster', removed: false, temp: false,
        _ctime: stamp, _mtime: stamp,
        state: {
            lastWatched: watching ? stamp : null,
            timeWatched: watching ? 600000 : 0,
            timeOffset: watching ? 600000 : 0,
            overallTimeWatched: watching ? 600000 : 0,
            timesWatched: 0, flaggedWatched: 0,
            duration: watching ? 3600000 : 0,
            video_id: watching ? (type === 'series' ? `${id}:1:1` : id) : null,
            watched: null, noNotif: false,
        },
        behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: type === 'series' },
    };
};

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// The meta of a library title, or null for ids that aren't in the library.
const libraryMeta = (id: string, now = Date.now()) => {
    const match = /^ttlib(series|movie)(\d+)$/.exec(id);
    if (!match) return null;
    const [, type, number] = match;
    const index = Number(number) - 1;
    const name = libraryName(type, index);
    return {
        id, type, name,
        poster: `${POSTER_HOST}/${encodeURIComponent(name)}.svg`,
        background: `${POSTER_HOST}/${encodeURIComponent(name)}.svg`,
        description: `Library item ${name}.`,
        releaseInfo: '2024',
        ...(type === 'series' ? { videos: episodes(id, index, now) } : {}),
    };
};

// Calendar asks Cinemeta's calendar-videos catalog for the library's series, with their videos.
const calendarVideos = (extra: string) => {
    const ids = new URLSearchParams(decodeURIComponent(extra)).get('calendarVideosIds');
    if (ids === null) return null;
    return { metasDetailed: ids.split(',').map((id) => libraryMeta(id)).filter((meta) => meta !== null) };
};

const serveAccount = async (context: BrowserContext, library: Partial<Library> = {}) => {
    const { series, movies, watching } = { ...DEFAULT_LIBRARY, ...library };
    const now = Date.now();
    // Answers addonCollectionGet; tv.ts fills it with the app's default addons before logging in.
    let addons: unknown[] = [];
    const items = [
        ...Array.from({ length: series }, (_, index) => libraryItem('series', index, index < watching / 2, now)),
        ...Array.from({ length: movies }, (_, index) => libraryItem('movie', index, index < watching / 2, now)),
    ];
    await context.route('https://api.strem.io/api/**', (route) => {
        const method = new URL(route.request().url()).pathname.split('/').pop() ?? '';
        const results: Record<string, unknown> = {
            login: { authKey: 'e2e-auth-key', user: USER },
            getUser: USER,
            datastoreMeta: items.map((item) => [item._id, Date.parse(item._mtime)]),
            datastoreGet: items,
            datastorePut: { success: true },
            addonCollectionGet: { addons, lastModified: '2026-01-01T00:00:00.000Z' },
            getModal: null,
            getNotification: null,
        };
        if (method in results) return json(route, { result: results[method] });
        return json(route, { error: { message: `${method} is not faked`, code: 1 } });
    });
    return { setAddons: (list: unknown[]) => { addons = list; } };
};

export { calendarVideos, libraryMeta, serveAccount };
