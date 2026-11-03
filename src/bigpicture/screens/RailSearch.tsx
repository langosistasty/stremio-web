// Stremio Big Picture: Search in the nav rail. Board hides the top bar to make room for
// its hero, and on a TV the rail is where screens are picked, so Search gets a tab there,
// second after Board. It's upstream's own tab button, rendered into the rail on screen.
// SPDX-License-Identifier: GPL-2.0-only

import React from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import usePortalTarget from './usePortalTarget';

const NavTabButton = require('stremio/components/NavBar/VerticalNavBar/NavTabButton');
const railStyles = require('stremio/components/NavBar/VerticalNavBar/styles');

const RAIL = '[class*="vertical-nav-bar-container-"]';

const RailSearch = ({ active }: { active: boolean }) => {
    const { t } = useTranslation();
    const location = useLocation();
    const target = usePortalTarget(RAIL, active);
    if (!target) return null;
    return createPortal(
        <div className={'bigpicture-rail-search'} data-bigpicture-rail-search={''}>
            <NavTabButton
                className={railStyles['nav-tab-button']}
                selected={location.pathname === '/search'}
                href={'/search'}
                icon={'search'}
                label={t('STREMIO_TV_NAV_SEARCH', { defaultValue: 'Search' })}
            />
        </div>,
        target,
    );
};

export default RailSearch;
