import mitt from 'mitt'

type Events = {
  event: void
  scanFinished: void // 添加歌曲扫描结束
  playlistsChanged: void
  tagsChanged: void
  songActionsMenuOpened: 'footer' | 'songlist'
  locateCurrentSong: void
}

const eventBus = mitt<Events>()
export default eventBus
