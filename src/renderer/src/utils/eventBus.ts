import mitt from 'mitt'

type Events = {
  event: void
  scanFinished: void // 添加歌曲扫描结束
  playlistsChanged: void
  playlistRenamed: number
  tagsChanged: void
  lyricsUpdated: number
  songActionsMenuOpened: 'footer' | 'songlist'
  locateCurrentSong: void
  openAudioControls: void
}

const eventBus = mitt<Events>()
export default eventBus
