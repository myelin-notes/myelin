import {definePreset, palette} from "@primevue/themes";
import Aura from '@primevue/themes/aura';

const theme = window.getComputedStyle(document.body);
const primaryC = theme.getPropertyValue('--c-primary');
const surfaceC = theme.getPropertyValue('--c-secondary');
const textC = theme.getPropertyValue('--c-text');
const iconC = theme.getPropertyValue('--c-icons');
const regPadding = theme.getPropertyValue('--p-padding-reg');
const shadow = theme.getPropertyValue('--p-box-shadow')
const bgC = theme.getPropertyValue('--c-surface');

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

const secondaryBtnConfig = {
    background: '{background.500}',
    hoverBackground: '{surface.500}',
    activeBackground: '{surface.500}',
    borderColor: 'transparent',
    hoverBorderColor: 'transparent',
    activeBorderColor: '{surface.500}',
};

const textConfig = {
    color: '{textColor.500}',
    hoverColor: '{textColor.600}',
    mutedColor: '{textColor.200}',
    hoverMutedColor: '{textColor.300}'
};

export const MyelinPreset = definePreset(Aura, {
    primitive: {
        borderRadius: {
            md: '8px',
        },
        red: palette("#FFA8A9"),
        green: palette("#7dc257"),
    },
    semantic: {
        primary: palette(primaryC),
        textColor: palette(textC),
        background: palette(bgC),
        transitionDuration: theme.getPropertyValue('--p-transition-duration'),
        colorScheme: {
            light: {
                navigation: navigationConfig,
                surface: palette(surfaceC),
                text: textConfig,
                formField: {
                    color: '{textColor.500}',
                    placeholderColor: '{textColor.200}',
                },
            },
            dark: {
                navigation: navigationConfig,
                surface: palette(surfaceC),
                text: textConfig,
                formField: {
                    color: '{textColor.500}',
                    placeholderColor: '{textColor.200}',
                },
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
        },
        button: {
            colorScheme: {
                light: {
                    secondary: secondaryBtnConfig,
                    text: {
                        secondary: {
                            hoverBackground: '{surface.500}',
                            activeBackground: '{surface.500}',
                            color: '{text.color}',
                        },
                    },
                },
                dark: {
                    secondary: secondaryBtnConfig,
                    text: {
                        secondary: {
                            hoverBackground: '{surface.500}',
                            activeBackground: '{surface.500}',
                            color: '{text.color}',
                        },
                    },
                },
            },
        },
    },
});
