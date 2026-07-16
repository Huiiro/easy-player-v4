import mitt from 'mitt'

type Events = {
  event: void
  scanFinished: void // 添加歌曲扫描结束
}

const eventBus = mitt<Events>()
export default eventBus
