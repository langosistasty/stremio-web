// Stremio Big Picture: a fake addon backend, so tests see the same catalogs every run.
// Answers the default addons' catalog, meta, stream and subtitle requests, and draws posters.
// SPDX-License-Identifier: GPL-2.0-only

import type { BrowserContext, Route } from '@playwright/test';

const ITEMS_PER_CATALOG = 12;
const POSTER_HOST = 'https://posters.e2e.invalid';

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
    await context.route(RESOURCE, async (route) => {
        const [, resource, type, rawId, extra] = new URL(route.request().url()).pathname.match(RESOURCE)!;
        const id = decodeURIComponent(rawId);
        switch (resource) {
            case 'catalog': {
                const delayMs = typeof delay === 'number' ? delay : delay[`${type}/${id}`] ?? 0;
                if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
                // Only the first page: a skip or search query gets an empty list.
                if (extra) return json(route, { metas: [] });
                return json(route, {
                    metas: Array.from({ length: ITEMS_PER_CATALOG }, (_, index) => (
                        meta(type, itemId(type, id, index), title(type, id, index))
                    )),
                });
            }
            case 'meta':
                return json(route, { meta: meta(type, id, id.replace(/^tt/, '').replace(/-/g, ' ')) });
            case 'stream':
                return json(route, { streams: [] });
            default:
                return json(route, { subtitles: [] });
        }
    });
};

export type { CatalogDelay };
export { serveCatalogs, title };
