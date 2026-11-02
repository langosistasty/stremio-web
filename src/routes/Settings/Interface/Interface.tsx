import React, { forwardRef } from 'react';
import { usePlatform } from 'stremio/common';
import { Scale, MultiselectMenu, Toggle } from 'stremio/components';
import { Section, Option } from '../components';
// Big Picture (fork change, 2026-11-02): 10-foot TV mode settings, see BIGPICTURE.md.
import { BigPictureSettings, useBigPicture } from 'stremio/bigpicture';
import useInterfaceOptions from './useInterfaceOptions';

type Props = {
    profile: Profile,
};

const Interface = forwardRef<HTMLDivElement, Props>(({ profile }: Props, ref) => {
    const { shell } = usePlatform();
    const bigPicture = useBigPicture();

    const {
        interfaceLanguageSelect,
        interfaceSize,
        quitOnCloseToggle,
        escExitFullscreenToggle,
        hideSpoilersToggle,
        gamepadSupportToggle,
    } = useInterfaceOptions(profile);

    return (
        <Section ref={ref} label={'INTERFACE'}>
            <Option label={'SETTINGS_UI_LANGUAGE'}>
                <MultiselectMenu
                    className={'multiselect'}
                    {...interfaceLanguageSelect}
                />
            </Option>
            <Option label={'SETTINGS_UI_ZOOM'}>
                <Scale {...interfaceSize} />
            </Option>
            <BigPictureSettings />
            {
                shell.active &&
                    <Option label={'SETTINGS_QUIT_ON_CLOSE'}>
                        <Toggle
                            tabIndex={-1}
                            {...quitOnCloseToggle}
                        />
                    </Option>
            }
            {
                shell.active && !bigPicture.enabled &&
                    <Option label={'SETTINGS_FULLSCREEN_EXIT'}>
                        <Toggle
                            tabIndex={-1}
                            {...escExitFullscreenToggle}
                        />
                    </Option>
            }
            <Option label={'SETTINGS_BLUR_UNWATCHED_IMAGE'}>
                <Toggle
                    tabIndex={-1}
                    {...hideSpoilersToggle}
                />
            </Option>
            <Option label={'SETTINGS_GAMEPAD'}>
                <Toggle
                    tabIndex={-1}
                    {...gamepadSupportToggle}
                />
            </Option>
        </Section>
    );
});

export default Interface;
