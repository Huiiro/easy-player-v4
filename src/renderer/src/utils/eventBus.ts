import mitt from 'mitt'

type Events = {
  event: void
  scanFinished: void // 添加歌曲扫描结束
  importLocalMusic: void
  playlistsChanged: void
  playlistRenamed: number
  tagsChanged: void
  musicSourcesChanged: void
  songLyricSettingsChanged: number
  lyricsUpdated: number
  songActionsMenuOpened: 'footer' | 'songlist'
  songsPreferenceChanged: { songIds: number[]; preference: -1 | 0 | 1 }
  songsLyricFlagsChanged: { songIds: number[]; disableNetwork?: boolean; instrumental?: boolean }
  songPreferenceChanged: { songId: number; preference: -1 | 0 | 1 }
  songPreferencesCleared: { songIds: number[] }
  locateCurrentSong: void
  openAudioControls: void
  openGlobalSearch: void
}

const eventBus = mitt<Events>()
export default eventBus
