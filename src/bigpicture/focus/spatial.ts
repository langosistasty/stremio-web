// Stremio Big Picture: pick the next control in an arrow's direction.
// The bundled spatial-navigation polyfill measures some origins against their scroll
// container instead of themselves (when its hit test fails, as on Settings switches),
// which skips controls or moves the wrong way. This is a small, predictable replacement.
// SPDX-License-Identifier: GPL-2.0-only

import type { Direction } from './dom';

// Up and Down weigh distance against being out of line, so a two-column form (labels
// left, controls right) is walked in reading order and a grid keeps its column.
const MISALIGNMENT_WEIGHT = 2;
// Among equally aligned candidates, prefer the one centred on the origin.
const CENTRE_WEIGHT = 0.25;

type Box = { left: number, right: number, top: number, bottom: number };

const gap = (startA: number, endA: number, startB: number, endB: number) => Math.max(0, startB - endA, startA - endB);

type Score = { value: number, aligned: boolean };

const score = (origin: Box, box: Box, direction: Direction): Score | null => {
    const vertical = direction === 'up' || direction === 'down';
    // In that direction: starting past the origin's middle. Edges alone would reject
    // overlapping layouts, like a notification bar over the last row.
    const midX = (origin.left + origin.right) / 2;
    const midY = (origin.top + origin.bottom) / 2;
    const beyond = {
        down: box.top >= midY,
        up: box.bottom <= midY,
        right: box.left >= midX,
        left: box.right <= midX,
    }[direction];
    if (!beyond) return null;
    const distance = Math.max(0, {
        down: box.top - origin.bottom,
        up: origin.top - box.bottom,
        right: box.left - origin.right,
        left: origin.left - box.right,
    }[direction]);

    const misalignment = vertical ?
        gap(origin.left, origin.right, box.left, box.right) :
        gap(origin.top, origin.bottom, box.top, box.bottom);
    const offCentre = vertical ?
        Math.abs((origin.left + origin.right) / 2 - (box.left + box.right) / 2) :
        Math.abs((origin.top + origin.bottom) / 2 - (box.top + box.bottom) / 2);

    return {
        value: distance + MISALIGNMENT_WEIGHT * misalignment + CENTRE_WEIGHT * offCentre,
        aligned: misalignment === 0,
    };
};

// Whether something else covers the element everywhere, like a poster under a
// notification bar. Only judged for a control wholly on screen: one partly scrolled
// away can be scrolled into view, so it stays reachable.
const hidden = (element: HTMLElement) => {
    const { left, top, width, height, right, bottom } = element.getBoundingClientRect();
    if (left < 0 || top < 0 || right > window.innerWidth || bottom > window.innerHeight) return false;
    const points = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]
        .map(([x, y]) => [left + width * x, top + height * y]);
    return points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && !element.contains(hit) && !hit.contains(element);
    });
};

// The lowest-scoring candidate in the direction that isn't covered. Without
// allowMisaligned only candidates in line count (Left and Right, so a row's end is a
// dead end, not a jump to another row). Ties keep the earlier one in document order.
const nextInDirection = (origin: HTMLElement, candidates: HTMLElement[], direction: Direction, allowMisaligned: boolean): HTMLElement | null => {
    const from = origin.getBoundingClientRect();
    const scored: { candidate: HTMLElement, value: number }[] = [];
    for (const candidate of candidates) {
        if (candidate === origin || candidate.contains(origin) || origin.contains(candidate)) continue;
        const result = score(from, candidate.getBoundingClientRect(), direction);
        if (result === null || (!result.aligned && !allowMisaligned)) continue;
        scored.push({ candidate, value: result.value });
    }
    // Stable sort keeps document order among ties; hit tests run only until one passes.
    scored.sort((a, b) => a.value - b.value);
    return scored.find(({ candidate }) => !hidden(candidate))?.candidate ?? null;
};

export default nextInDirection;
