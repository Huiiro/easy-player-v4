// import { computed } from 'vue'
// import { useI18n } from 'vue-i18n'
// import { usePlayStore } from '@/store/play'
// import { LyricsSource } from '@/consts/enums/player'
//
// export function useLyrics() {
//   const { t } = useI18n()
//   const playStore = usePlayStore()
//
//   /**
//    * 当前歌词
//    */
//   const lyrics = computed(() => {
//     const list =
//       playStore.lyricSource === LyricsSource.ExternalLrc
//         ? playStore.currentTrack.externalLrc
//         : playStore.currentTrack.embeddedLrc
//
//     if (!list?.length) {
//       return [
//         {
//           time: 0,
//           text: t('no_lyrics_alt')
//         }
//       ]
//     }
//
//     if (list[0]?.text === 'no_lyrics_alt') {
//       return [
//         {
//           time: 0,
//           text: t('no_lyrics_alt')
//         }
//       ]
//     }
//
//     return list
//   })
//
//   /**
//    * 当前时间（带 offset）
//    */
//   const currentTime = computed(() => {
//     return playStore.currentTime + playStore.lyricOffset
//   })
//
//   /**
//    * 是否无歌词
//    */
//   const hasLyrics = computed(() => {
//     return !(lyrics.value.length === 1 && lyrics.value[0].text === t('no_lyrics_alt'))
//   })
//
//   return {
//     lyrics,
//     currentTime,
//     hasLyrics
//   }
// }
