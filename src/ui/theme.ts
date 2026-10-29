import pc from 'picocolors';

export interface ThemeColors {
  primary: (s: string) => string;
  secondary: (s: string) => string;
  accent: (s: string) => string;
  muted: (s: string) => string;
  success: (s: string) => string;
  warning: (s: string) => string;
  error: (s: string) => string;
  code: (s: string) => string;
  highlight: (s: string) => string;
}

export function getTheme(themeName = 'default'): ThemeColors {
  switch (themeName) {
    case 'ocean':
      return {
        primary: pc.cyan,
        secondary: pc.blue,
        accent: pc.magenta,
        muted: pc.dim,
        success: pc.green,
        warning: pc.yellow,
        error: pc.red,
        code: pc.cyan,
        highlight: pc.bold
      };
    case 'minimal':
      return {
        primary: s => s,
        secondary: pc.dim,
        accent: pc.bold,
        muted: pc.dim,
        success: pc.green,
        warning: pc.yellow,
        error: pc.red,
        code: s => `\`${s}\``,
        highlight: pc.bold
      };
    case 'default':
    default:
      return {
        primary: pc.magenta,
        secondary: pc.cyan,
        accent: pc.bold,
        muted: pc.dim,
        success: pc.green,
        warning: pc.yellow,
        error: pc.red,
        code: pc.yellow,
        highlight: pc.bold
      };
  }
}
