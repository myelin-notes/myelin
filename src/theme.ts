
import {definePreset, palette} from "@primevue/themes";
import Aura from '@primevue/themes/aura';

const theme = window.getComputedStyle(document.body);
const primaryC = theme.getPropertyValue('--c-primary');
const surfaceC = theme.getPropertyValue('--c-secondary');
const textC = theme.getPropertyValue('--c-text');
const iconC = theme.getPropertyValue('--c-icons');
const regPadding = theme.getPropertyValue('--p-padding-reg');
const shadow = theme.getPropertyValue('--p-box-shadow')

const navigationConfig = {
    item: {
        focusBackground: surfaceC,
        activeBackground: surfaceC,
        color: textC,
        focusColor: textC,
        activeColor: textC,
        icon: {
            color: primaryC,
            focusColor: iconC,
            activeColor: iconC
        }
    },
    submenuLabel: {
        background: 'transparent',
        color: textC
    },
    submenuIcon: {
        color: primaryC,
        focusColor: iconC,
        activeColor: iconC
    }
};

export const MyelinPreset = definePreset(Aura, {
    primitive: {
        borderRadius: {
            md: '8px',
        },
    },
    semantic: {
        primary: palette(primaryC),
        surface: palette(surfaceC),
        transitionDuration: theme.getPropertyValue('--p-transition-duration'),
        text: {
            color: textC,
            hoverColor: textC,
            mutedColor: textC,
            hoverMutedColor: textC
        },
        colorScheme: {
            light: {
                navigation: navigationConfig
            },
            dark: {
                navigation: navigationConfig
            }
        },
        overlay: {
            popover: {
                padding: regPadding,
                shadow: shadow
            },
            modal: {
                borderRadius: '{border.radius.md}',
                padding: regPadding,
                shadow: shadow
            },
            navigation: {
                shadow: shadow
            }
        },
    },
    components: {
        dialog: {
            borderColor: 'transparent',
            shadow: 'none',
        },
        divider: {
            horizontalMargin: '8px 0 8px 0',
        },
        popover: {
            contentPadding: `${regPadding} 0`
        }
    },
});
