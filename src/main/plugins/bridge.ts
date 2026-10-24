import { t } from '../i18n'
import { isPlaybackOnly, requireBackgroundWork } from '../service/playbackMode'
import { backgroundRequest, runYtDlp, fetchMediaImage } from '../service/mediaDownloadRuntime'

/** Compatibility bridge for already published API v1 archives only. API v2 uses PluginHostContext. */
export const officialPluginBridge = {
  t,
  isPlaybackOnly,
  requireBackgroundWork,
  backgroundRequest,
  runYtDlp,
  fetchMediaImage
}
