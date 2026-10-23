import mitt from 'mitt'

type Events = {
  event: void
  scanFinished: void // 添加歌曲扫描结束
  importLocalMusic: void
  playlistsChanged: void
  playlistRenamed: number
  tagsChanged: void
  lyricsUpdated: number
  songActionsMenuOpened: 'footer' | 'songlist'
  songPreferenceChanged: { songId: number; preference: -1 | 0 | 1 }
  locateCurrentSong: void
  openAudioControls: void
  openGlobalSearch: void
}

const eventBus = mitt<Events>()
export default eventBus
