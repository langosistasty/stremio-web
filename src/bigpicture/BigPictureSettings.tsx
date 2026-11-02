// Stremio Big Picture: the rows shown in Settings > Interface.
// SPDX-License-Identifier: GPL-2.0-only

import React from 'react';
import { MultiselectMenu } from 'stremio/components';
import { Option } from 'stremio/routes/Settings/components';
import BigPictureToggle from './BigPictureToggle';
import { OVERSCAN_MARGINS, TV_SCALES, useBigPictureLayout } from './store';

const SCALE_OPTIONS = TV_SCALES.map((value) => ({ value, label: `${value}%` }));
const OVERSCAN_OPTIONS = OVERSCAN_MARGINS.map((value) => ({ value, label: value === 0 ? 'None' : `${value}%` }));

// The TV rows only appear while Big Picture is on, since they only apply then.
const BigPictureSettings = () => {
    const { enabled, tvScale, overscan, setTvScale, setOverscan } = useBigPictureLayout();

    return (
        <>
            <Option label={'Big Picture mode'}>
                <BigPictureToggle />
            </Option>
            {
                enabled &&
                    <Option label={'TV size'}>
                        <MultiselectMenu className={'multiselect'} title={`${tvScale}%`} options={SCALE_OPTIONS} value={tvScale} onSelect={(value) => setTvScale(Number(value))} />
                    </Option>
            }
            {
                enabled &&
                    <Option label={'TV safe margin'}>
                        <MultiselectMenu className={'multiselect'} options={OVERSCAN_OPTIONS} value={overscan} onSelect={(value) => setOverscan(Number(value))} />
                    </Option>
            }
        </>
    );
};

export default BigPictureSettings;
