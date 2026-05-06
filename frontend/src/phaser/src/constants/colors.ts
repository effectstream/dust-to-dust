// Palette: NA16 https://lospec.com/palette-list/na16
// With additional colors
export enum Color {
    // NA16 Palette Color
    GrayPurple = '#8c8fae',
    Purple = '#584563',
    DeepPlum = '#3e2137',
    Brown = '#9a6348',
    Tan = '#d79b7d',
    Cream = '#f5edba',
    Olive = '#c0c741',
    Green = '#647d34',
    Orange = '#e4943a',
    Red = '#9d303b',
    Pink = '#d26471',
    Violet = '#70377f',
    Turquoise = '#7ec4c1',
    Blue = '#34859d',
    DarkGreen = '#17434b',
    Licorice = '#1f0e1c',

    // Additional non-NA16 colors

    // highlights
    Yellow = '#fff400',
    Black = '#000000',
    White = '#f0f0f0',
    PureWhite = '#ffffff',

    // UI
    StoneHighlight = '#d8d9ca',
    Stone = '#bdbbaa',
    StoneShadowLight = '#827d70',
    StoneShadowDark = '#524440',

    // background colors
    BgGreenLight = '#798b56',
    BgGreenDark = '#576b3f',

    // color transformations
    // not used anywhere directly --- only used for darkening transformations
    TransformDarker = '#adadad',
}

export const colorToNumber = (color: Color): number => {
    // Helper function to convert Color enum value to hex number
    return Phaser.Display.Color.HexStringToColor(color).color
}