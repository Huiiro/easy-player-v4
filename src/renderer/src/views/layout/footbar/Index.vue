<script setup lang="ts">
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { formatTime } from '@/utils/formatter'

const ui = useUIStore()
const player = usePlayerStore()
</script>

<template>
<!--  <footer-->
<!--    class="relative z-50 bg-bg text-text flex items-center h-16 px-4 select-none transition-opacity duration-300"-->
<!--    :class="[-->
<!--      ui.showPlayer ? 'bg-transparent' : '',-->
<!--      visible ? 'opacity-100' : 'opacity-0 pointer-events-none'-->
<!--    ]"-->
<!--    @click="ui.toggleShowPlayer"-->
<!--  >-->
<!--    &lt;!&ndash; 遮罩 &ndash;&gt;-->
<!--    <div-->
<!--      class="absolute inset-0 -z-10 bg-black pointer-events-none"-->
<!--      :class="ui.showPlayer ? 'opacity-0' : 'opacity-35'"-->
<!--    />-->

<!--    &lt;!&ndash; 遮罩 &ndash;&gt;-->
<!--    <div-->
<!--      v-if="ui.useDynamicBg && ui.currentDynamicBg.footer"-->
<!--      class="absolute inset-0 -z-10"-->
<!--      :style="ui.currentDynamicBg.footer"-->
<!--    />-->

<!--    &lt;!&ndash; 新播放条控制 &ndash;&gt;-->
<!--&lt;!&ndash;    <PlayerProgressControl&ndash;&gt;-->
<!--&lt;!&ndash;      v-if="ui.useFullProgress"&ndash;&gt;-->
<!--&lt;!&ndash;      :current-time="player.currentTime"&ndash;&gt;-->
<!--&lt;!&ndash;      :duration="player.duration"&ndash;&gt;-->
<!--&lt;!&ndash;      @progress-change="(t) => audioController.setCurrentTime(t)"&ndash;&gt;-->
<!--&lt;!&ndash;    />&ndash;&gt;-->

<!--    &lt;!&ndash; 左侧封面与信息 &ndash;&gt;-->
<!--&lt;!&ndash;    <TrackInfo&ndash;&gt;-->
<!--&lt;!&ndash;      v-if="!playStore.showPlayer"&ndash;&gt;-->
<!--&lt;!&ndash;      :cover="playStore.currentTrack.cover"&ndash;&gt;-->
<!--&lt;!&ndash;      :title="playStore.currentTrack.title"&ndash;&gt;-->
<!--&lt;!&ndash;      :artist="playStore.currentTrack.artist"&ndash;&gt;-->
<!--&lt;!&ndash;    />&ndash;&gt;-->

<!--    &lt;!&ndash; 播放控制器 &ndash;&gt;-->
<!--    <div-->
<!--      class="absolute left-1/2 -translate-x-1/2"-->
<!--      :class="ui.useFullProgress ? '' : 'w-[22rem] xl:w-[36rem]'"-->
<!--    >-->
<!--      <PlayerControls-->
<!--        :current-track="playStore.currentTrack"-->
<!--        :is-playing="playStore.isPlaying"-->
<!--        :current-time="formatTime(player.positionMs)"-->
<!--        :use-full-progress="uiStore.useFullProgressStyle"-->
<!--        @toggle-play="audioController.togglePlay()"-->
<!--        @prev-track="audioController.playPrevSong()"-->
<!--        @next-track="audioController.playNextSong()"-->
<!--        @progress-change="(t) => audioController.setCurrentTime(t)"-->
<!--      />-->
<!--    </div>-->

<!--    &lt;!&ndash; 右侧控制区 &ndash;&gt;-->
<!--    <div class="flex items-center gap-3 h-full ml-auto" @click.stop>-->
<!--      &lt;!&ndash; 新播放条样式时间 &ndash;&gt;-->
<!--      <div-->
<!--        v-if="ui.useFullProgress"-->
<!--        class="w-full flex justify-between text-xs text-white select-none"-->
<!--      >-->
<!--        <span>{{ formatTime(playStore.currentTime) }}</span>-->
<!--        <span>&nbsp;/&nbsp;</span>-->
<!--        <span>{{ formatTime(playStore.currentTrack.duration) }}</span>-->
<!--      </div>-->
<!--      &lt;!&ndash; 播放方式控制按钮 &ndash;&gt;-->
<!--      <button-->
<!--        :title="playModeTitle"-->
<!--        class="text-white text-lg select-none btn-hover"-->
<!--        @click.stop="playStore.togglePlayMode"-->
<!--      >-->
<!--        <svgIcon :name="playModeIconName" class-name="w-6 h-6 icon" />-->
<!--      </button>-->

<!--      &lt;!&ndash; 播放列表控制 &ndash;&gt;-->
<!--      <button-->
<!--        v-if="uiStore.customComponentPlaylistBtn"-->
<!--        :title="t('playlist_alt')"-->
<!--        class="text-white text-lg select-none btn-hover"-->
<!--        @click.stop="drawer = true"-->
<!--      >-->
<!--        <svgIcon name="control-playlist" class-name="w-6 h-6 icon" />-->
<!--      </button>-->

<!--      &lt;!&ndash; 桌面歌词 &ndash;&gt;-->
<!--      <button-->
<!--        :title="t('desktop_lyrics_alt')"-->
<!--        class="text-white text-lg select-none btn-hover"-->
<!--        :class="uiStore.desktopLyrics ? 'text-primary' : 'text-white'"-->
<!--        @click.stop="uiStore.toggleDesktopLyrics"-->
<!--      >-->
<!--        <svgIcon name="common-lyrics" class-name="w-7 h-7 icon mt-1" />-->
<!--      </button>-->

<!--      &lt;!&ndash; 效果均衡器 &ndash;&gt;-->
<!--      <button-->
<!--        :title="t('eq_alt')"-->
<!--        class="text-white text-lg select-none btn-hover"-->
<!--        @click.stop="EQDialogVisible = true"-->
<!--      >-->
<!--        <svgIcon name="common-equalizer" class-name="w-5 h-5 icon" />-->
<!--      </button>-->

<!--      &lt;!&ndash; 音量 &ndash;&gt;-->
<!--&lt;!&ndash;      <VolumeVertical />&ndash;&gt;-->

<!--      &lt;!&ndash; 更多 &ndash;&gt;-->
<!--&lt;!&ndash;      <More />&ndash;&gt;-->
<!--    </div>-->
<!--  </footer>-->
</template>
