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
// Layouts overlap a little (borders, negative margins); this still counts as beside.
const TOLERANCE = 2;

type Box = { left: number, right: number, top: number, bottom: number };

const gap = (startA: number, endA: number, startB: number, endB: number) => Math.max(0, startB - endA, startA - endB);

type Score = { value: number, aligned: boolean };

const score = (origin: Box, box: Box, direction: Direction): Score | null => {
    const vertical = direction === 'up' || direction === 'down';
    const distance = {
        down: box.top - origin.bottom,
        up: origin.top - box.bottom,
        right: box.left - origin.right,
        left: origin.left - box.right,
    }[direction];
    if (distance < -TOLERANCE) return null;

    const misalignment = vertical ?
        gap(origin.left, origin.right, box.left, box.right) :
        gap(origin.top, origin.bottom, box.top, box.bottom);
    const offCentre = vertical ?
        Math.abs((origin.left + origin.right) / 2 - (box.left + box.right) / 2) :
        Math.abs((origin.top + origin.bottom) / 2 - (box.top + box.bottom) / 2);

    return {
        value: Math.max(0, distance) + MISALIGNMENT_WEIGHT * misalignment + CENTRE_WEIGHT * offCentre,
        aligned: misalignment === 0,
    };
};

// The lowest-scoring candidate in the direction. Without allowMisaligned only candidates
// in line count (Left and Right, so a row's end is a dead end, not a jump to another
// row). Ties keep the earlier one in document order.
const nextInDirection = (origin: HTMLElement, candidates: HTMLElement[], direction: Direction, allowMisaligned: boolean): HTMLElement | null => {
    const from = origin.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestValue = Infinity;
    for (const candidate of candidates) {
        if (candidate === origin || candidate.contains(origin) || origin.contains(candidate)) continue;
        const result = score(from, candidate.getBoundingClientRect(), direction);
        if (result === null || (!result.aligned && !allowMisaligned)) continue;
        if (result.value < bestValue) {
            best = candidate;
            bestValue = result.value;
        }
    }
    return best;
};

export default nextInDirection;
