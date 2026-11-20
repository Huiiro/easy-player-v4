import { isSystemBackground } from '@/components/background/systemBackgroundRegistry'
import { resolveLiquidGlassSettings } from '@/services/liquidGlassProfile'
import {
  resolvePlayerBgType,
  resolvePlayerBgTypeBeforeCheer,
  resolvePlayerCheerColor,
  resolvePlayerCheerColorMode,
  resolvePlayerCheerColors,
  resolvePlayerCheerLights
} from '@/constants'

/** Migrate the former artist/genre switches before Pinia picks persisted fields. */
export function deserializeUIPreferences(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const { normalizeArtistSeparator, normalizeGenreSeparator, ...preferences } = parsed as Record<
    string,
    unknown
  >
  return {
    ...preferences,
    playerBgType: resolvePlayerBgType(preferences.playerBgType),
    playerBgTypeBeforeCheer: resolvePlayerBgTypeBeforeCheer(preferences.playerBgTypeBeforeCheer),
    playerCheerColor: resolvePlayerCheerColor(preferences.playerCheerColor),
    playerCheerColorMode: resolvePlayerCheerColorMode(preferences.playerCheerColorMode),
    playerCheerColors: resolvePlayerCheerColors(preferences.playerCheerColors),
    playerCheerLights: resolvePlayerCheerLights(preferences.playerCheerLights),
    playerLayout: preferences.playerLayout === 'bottom' ? 'bottom' : 'classic',
    showPlayerAudioDetails:
      typeof preferences.showPlayerAudioDetails === 'boolean'
        ? preferences.showPlayerAudioDetails
        : true,
    playerLyricsFontWeight:
      typeof preferences.playerLyricsFontWeight === 'number' &&
      [300, 400, 500, 600, 700, 800].includes(preferences.playerLyricsFontWeight)
        ? preferences.playerLyricsFontWeight
        : 700,
    interfaceEffect:
      preferences.interfaceEffect === 'liquid-glass-studio' ? 'liquid-glass-studio' : 'none',
    liquidGlassSettings: resolveLiquidGlassSettings(preferences.liquidGlassSettings),
    autoCheckUpdates:
      typeof preferences.autoCheckUpdates === 'boolean' ? preferences.autoCheckUpdates : true,
    ignoredUpdateVersions: Array.isArray(preferences.ignoredUpdateVersions)
      ? preferences.ignoredUpdateVersions.filter(
          (version): version is string => typeof version === 'string'
        )
      : [],
    systemBackground: isSystemBackground(preferences.systemBackground)
      ? preferences.systemBackground
      : 'none',
    normalizeMetadataSeparator:
      typeof preferences.normalizeMetadataSeparator === 'boolean'
        ? preferences.normalizeMetadataSeparator
        : normalizeArtistSeparator === true || normalizeGenreSeparator === true
  }
}
