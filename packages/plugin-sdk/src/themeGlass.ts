/** Public CSS tokens consumed by the built-in Liquid Glass component material.
 * Values remain declarative CSS and pass the host's normal theme validation.
 */
export const THEME_GLASS_TOKENS = {
  '--ep-glass-control-radius': { value: '10px', description: '输入框、选择器和颜色按钮圆角' },
  '--ep-glass-button-radius': { value: '999px', description: '按钮圆角' },
  '--ep-glass-dialog-radius': { value: '22px', description: '弹窗和抽屉圆角' },
  '--ep-glass-floating-radius': { value: '16px', description: '菜单和浮层圆角' },
  '--ep-glass-message-radius': { value: '16px', description: '消息通知圆角' },
  '--ep-glass-control-bg': {
    value: 'color-mix(in srgb, var(--color-bg-l2) 28%, transparent)',
    description: '次要按钮和颜色按钮底色'
  },
  '--ep-glass-control-border': {
    value: 'color-mix(in srgb, var(--color-text) 14%, transparent)',
    description: '控件边框颜色'
  },
  '--ep-glass-control-highlight': {
    value: 'linear-gradient(135deg, rgb(255 255 255 / 14%), rgb(255 255 255 / 2%))',
    description: '控件和滑块表面高光'
  },
  '--ep-glass-control-shadow': {
    value: 'inset 0 1px 0 rgb(255 255 255 / 14%), 0 2px 8px rgb(0 0 0 / 8%)',
    description: '控件内高光和阴影'
  },
  '--ep-glass-input-bg': {
    value: 'color-mix(in srgb, var(--color-bg-d) 8%, transparent)',
    description: '输入框底色'
  },
  '--ep-glass-switch-inactive': {
    value: 'color-mix(in srgb, var(--color-text) 18%, transparent)',
    description: '开关关闭轨道颜色'
  },
  '--ep-glass-switch-thumb': {
    value: 'color-mix(in srgb, var(--color-white, #fff) 88%, transparent)',
    description: '开关滑块颜色'
  },
  '--ep-glass-track': {
    value: 'color-mix(in srgb, var(--color-text) 22%, transparent)',
    description: '滑块和进度条未播放轨道'
  },
  '--ep-glass-track-fill': { value: 'var(--color-primary)', description: '滑块和进度条已播放轨道' },
  '--ep-glass-thumb': {
    value: 'color-mix(in srgb, var(--color-text) 88%, var(--color-primary))',
    description: '滑块和原生进度条拇指颜色'
  },
  '--ep-glass-skeleton': {
    value: 'color-mix(in srgb, var(--color-text) 10%, transparent)',
    description: '骨架屏底色'
  },
  '--ep-glass-surface-border': {
    value: 'color-mix(in srgb, var(--color-text) 10%, transparent)',
    description: '独立玻璃面板边框颜色'
  },
  '--ep-glass-surface-shadow': {
    value: '0 8px 32px rgb(0 0 0 / 10%), inset 0 .5px 1.5px rgb(255 255 255 / 6%)',
    description: '独立面板阴影'
  },
  '--ep-glass-chrome-tint': { value: '4%', description: 'Header 和侧栏底色比例' },
  '--ep-glass-footer-tint': { value: '6%', description: 'Footer 底色比例' },
  '--ep-glass-panel-tint': { value: '8%', description: '弹窗和抽屉底色比例' },
  '--ep-glass-floating-tint': { value: '12%', description: '菜单、颜色面板和消息底色比例' },
  '--ep-glass-floating-blur-radius': {
    value: '60',
    description: '浮层高斯采样半径，0–200，显示像素；缺省跟随当前光学预设'
  }
} as const

export type PluginThemeGlassToken = keyof typeof THEME_GLASS_TOKENS
/** BaseBackTop geometry also works when the glass effect is disabled. */
export const THEME_BACKTOP_TOKENS = {
  '--ep-backtop-size': { value: '36px', description: '回到顶部按钮宽高' },
  '--ep-backtop-radius': { value: '999px', description: '回到顶部按钮圆角' },
  '--ep-backtop-right': { value: '20px', description: '回到顶部按钮右侧间距' },
  '--ep-backtop-bottom': {
    value: '20px',
    description: '通用回到顶部按钮底部间距；歌曲列表缺省跟随 Footer 避让'
  }
} as const
export type PluginThemeBackTopToken = keyof typeof THEME_BACKTOP_TOKENS
/** Shared text tips and hover controls, with or without Liquid Glass. */
export const THEME_TOOLTIP_TOKENS = {
  '--ep-tooltip-bg': {
    value: 'var(--color-bg-l)',
    description: '提示层底色；玻璃开启时缺省跟随浮层染色'
  },
  '--ep-tooltip-text': { value: 'var(--color-text)', description: '提示层文字颜色' },
  '--ep-tooltip-border': {
    value: 'var(--color-border)',
    description: '提示层边框；玻璃开启时缺省跟随玻璃控件边框'
  },
  '--ep-tooltip-radius': { value: '10px', description: '提示层圆角' },
  '--ep-tooltip-shadow': {
    value: '0 6px 20px rgb(0 0 0 / 16%)',
    description: '提示层阴影；玻璃开启时缺省跟随玻璃面板阴影'
  },
  '--ep-tooltip-font-size': { value: '12px', description: '提示层字号' },
  '--ep-tooltip-padding': { value: '6px 10px', description: '文字提示内边距' },
  '--ep-tooltip-max-width': { value: '280px', description: '提示层最大宽度，自动限制在视口内' },
  '--ep-tooltip-control-width': { value: '40px', description: '竖向调节提示层宽度' },
  '--ep-tooltip-control-height': { value: '160px', description: '竖向调节提示层高度' }
} as const
export type PluginThemeTooltipToken = keyof typeof THEME_TOOLTIP_TOKENS
/** Known glass keys provide completion; all existing semantic tokens remain valid. */
export type PluginThemeTokens = Partial<
  Record<PluginThemeGlassToken | PluginThemeBackTopToken | PluginThemeTooltipToken, string>
> &
  Record<string, string>
