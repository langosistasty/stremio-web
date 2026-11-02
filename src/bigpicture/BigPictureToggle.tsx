// Stremio Big Picture: the switch shown in Settings > Interface.
// SPDX-License-Identifier: GPL-2.0-only

import React from 'react';
import { Toggle } from 'stremio/components';
import { useBigPicture } from './BigPicture';

// Focusable in every mode, so the keyboard can turn Big Picture on in the first place.
const BigPictureToggle = () => {
    const { enabled, setEnabled } = useBigPicture();
    const toggle = {
        role: 'switch' as const,
        onClick: () => setEnabled(!enabled),
    };

    return (
        <Toggle
            checked={enabled}
            aria-checked={enabled}
            aria-label={'Big Picture mode'}
            {...toggle}
        />
    );
};

export default BigPictureToggle;
