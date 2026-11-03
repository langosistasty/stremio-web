// Stremio Big Picture: a fake addon backend, so tests see the same catalogs every run.
// Answers the default addons' catalog, meta, stream and subtitle requests, and draws posters.
// SPDX-License-Identifier: GPL-2.0-only

import type { BrowserContext, Route } from '@playwright/test';

import { readFileSync, existsSync } from 'node:fs';
import { calendarVideos, libraryMeta } from './account';
import { join } from 'node:path';

const ITEMS_PER_CATALOG = 12;
const POSTER_HOST = 'https://posters.e2e.invalid';
// A short WebM clip (made by run.sh with ffmpeg), so the player has something to play.
const MEDIA_HOST = 'https://media.e2e.invalid';
const CLIP = join(__dirname, '..', 'fixtures', 'clip.webm');
// Only one addon answers with streams, so each title gets the same three.
const STREAM_HOST = 'watchhub.strem.io';

const streams = () => ['1080p', '720p', '480p'].map((quality, index) => ({
    name: `Fixture ${quality}`,
    title: `Test stream ${index + 1}\n${quality}`,
    url: `${MEDIA_HOST}/clip.webm?quality=${quality}`,
}));

const title = (type: string, catalog: string, index: number) => `${type} ${catalog} ${index + 1}`;
// One id per catalog item, so every poster on screen has its own link.
const itemId = (type: string, catalog: string, index: number) => `tt${type}-${catalog}-${index + 1}`.replace(/[^\w-]/g, '');

const meta = (type: string, id: string, name: string) => ({
    id,
    type,
    name,
    poster: `${POSTER_HOST}/${encodeURIComponent(name)}.svg`,
    background: `${POSTER_HOST}/${encodeURIComponent(name)}.svg`,
    description: `Test item ${name}.`,
    releaseInfo: '2024',
    genres: ['Drama'],
    ...(type === 'series' ? { videos: [1, 2, 3].map((episode) => ({ id: `${id}:1:${episode}`, title: `Episode ${episode}`, season: 1, episode, released: '2024-01-01T00:00:00.000Z' })) } : {}),
});

const poster = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
<rect width="300" height="450" fill="#2d2350"/><text x="150" y="225" fill="#fff" font-size="28" text-anchor="middle" font-family="sans-serif">${name.replace(/[<&]/g, '')}</text></svg>`;

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Addon resource paths: /<resource>/<type>/<id>[/<extra>].json
const RESOURCE = /\/(catalog|meta|stream|subtitles)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/;

// Simulates a slow network for catalog lists: one delay for all, or per "type/id".
type CatalogDelay = number | Record<string, number>;

const serveCatalogs = async (context: BrowserContext, delay: CatalogDelay = 0) => {
    await context.route(`${POSTER_HOST}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: poster(decodeURIComponent(new URL(route.request().url()).pathname.slice(1, -4))),
    }));
    // With Range support, so the player can seek.
    await context.route(`${MEDIA_HOST}/**`, (route) => {
        if (!existsSync(CLIP)) return route.abort('blockedbyclient');
        const clip = readFileSync(CLIP);
        const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? '');
        if (!range) {
            return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: clip });
        }
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
        return route.fulfill({
            status: 206,
            contentType: 'video/webm',
            headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${clip.length}` },
            body: clip.subarray(start, end + 1),
        });
    });
    await context.route(RESOURCE, async (route) => {
        const [, resource, type, rawId, extra] = new URL(route.request().url()).pathname.match(RESOURCE)!;
        const id = decodeURIComponent(rawId);
        switch (resource) {
            case 'catalog': {
                const delayMs = typeof delay === 'number' ? delay : delay[`${type}/${id}`] ?? 0;
                if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
                // A search returns three matches per catalog; further pages are empty.
                const search = extra && new URLSearchParams(decodeURIComponent(extra)).get('search');
                if (search) {
                    return json(route, {
                        metas: [1, 2, 3].map((n) => meta(type, itemId(type, `${id}-${search}`, n - 1), `${type} ${search} ${n}`)),
                    });
                }
                const calendar = extra && calendarVideos(extra);
                if (calendar) return json(route, calendar);
                if (extra) return json(route, { metas: [] });
                return json(route, {
                    metas: Array.from({ length: ITEMS_PER_CATALOG }, (_, index) => (
                        meta(type, itemId(type, id, index), title(type, id, index))
                    )),
                });
            }
            case 'meta':
                return json(route, { meta: libraryMeta(id) ?? meta(type, id, id.replace(/^tt/, '').replace(/-/g, ' ')) });
            case 'stream':
                return json(route, { streams: new URL(route.request().url()).hostname === STREAM_HOST ? streams() : [] });
            default:
                return json(route, { subtitles: [] });
        }
    });
};

export type { CatalogDelay };
export { POSTER_HOST, serveCatalogs, title };
