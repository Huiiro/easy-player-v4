export const PLAYBACK_SESSION_KEY = 'player.playback-session'
export const PLAYBACK_QUEUE_KEY = 'player.playback-queue'

export interface PlaybackSessionWrite {
  revision: number
  state: object
  queue?: readonly unknown[]
}
