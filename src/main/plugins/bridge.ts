import { t } from '../i18n'
import { isPlaybackOnly, requireBackgroundWork } from '../service/playbackMode'
import { backgroundRequest, runYtDlp, fetchMediaImage } from '../service/mediaDownloadRuntime'

/** Trusted official packages receive functions, never host module paths. */
export const officialPluginBridge = {
  t,
  isPlaybackOnly,
  requireBackgroundWork,
  backgroundRequest,
  runYtDlp,
  fetchMediaImage
}
