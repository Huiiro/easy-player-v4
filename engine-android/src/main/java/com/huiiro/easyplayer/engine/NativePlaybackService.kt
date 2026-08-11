package com.huiiro.easyplayer.engine

import android.app.*
import android.content.*
import android.media.*
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.*

/** Single-threaded Android host for NativeAudioEngine. Flutter binds here via a plugin. */
class NativePlaybackService : Service() {
    private val binder = LocalBinder()
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private lateinit var engine: NativeAudioEngine
    private lateinit var audioManager: AudioManager
    private lateinit var session: MediaSession
    private var focusRequest: AudioFocusRequest? = null
    private var requestedVolume = 1f
    private var resumeOnFocusGain = false
    private var title = "Easy Player"
    private var foreground = false
    @Volatile private var latestSnapshot = PlayerSnapshot(ENGINE_IDLE, 0.0, 0.0, null)

    data class PlayerSnapshot(
        val state: Int,
        val positionMs: Double,
        val durationMs: Double,
        val error: String?
    )

    private val poller = object : Runnable {
        override fun run() { publishState(); handler.postDelayed(this, POLL_MS) }
    }

    inner class LocalBinder : Binder() { fun service(): NativePlaybackService = this@NativePlaybackService }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        thread = HandlerThread("easy-player-engine").also { it.start() }
        handler = Handler(thread.looper)
        session = MediaSession(this, "easy-player").apply {
            setCallback(sessionCallback, handler)
            isActive = true
        }
        handler.post { engine = NativeAudioEngine(); handler.post(poller) }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_OPEN -> intent.getStringExtra(EXTRA_PATH)?.let { openAndPlay(it) }
            ACTION_PLAY -> play()
            ACTION_PAUSE -> pause()
            ACTION_STOP -> stopPlayback()
            ACTION_SEEK -> seek(intent.getDoubleExtra(EXTRA_POSITION_MS, 0.0))
        }
        return START_STICKY
    }

    fun open(path: String, newTitle: String = path.substringAfterLast('/')) = handler.post {
        title = newTitle
        engine.open(path)
        publishState()
    }
    fun openAndPlay(path: String, newTitle: String = path.substringAfterLast('/')) = handler.post {
        title = newTitle
        if (engine.open(path)) playInternal() else publishState()
    }
    fun play() = handler.post { playInternal() }
    fun pause() = handler.post {
        resumeOnFocusGain = false
        engine.pause(); abandonFocus(); publishState()
    }
    fun stopPlayback() = handler.post {
        resumeOnFocusGain = false
        engine.stop(); abandonFocus(); publishState()
    }
    fun seek(positionMs: Double) = handler.post { engine.seek(positionMs); publishState() }
    fun readEmbeddedLyrics(path: String, callback: (String?) -> Unit) = handler.post {
        callback(engine.readEmbeddedLyrics(path))
    }
    fun setVolume(volume: Float) = handler.post {
        requestedVolume = volume.coerceIn(0f, 1f)
        engine.setVolume(requestedVolume)
    }
    fun snapshot(): PlayerSnapshot = latestSnapshot

    private fun playInternal() {
        if (!requestFocus()) return
        engine.play()
        publishState()
    }

    private fun requestFocus(): Boolean {
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { change -> handler.post {
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS -> {
                        resumeOnFocusGain = false
                        engine.pause(); abandonFocus(); publishState()
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                        resumeOnFocusGain = latestSnapshot.state == ENGINE_PLAYING
                        engine.pause(); publishState()
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> engine.setVolume(requestedVolume * DUCK_FACTOR)
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        engine.setVolume(requestedVolume)
                        if (resumeOnFocusGain) engine.play()
                        resumeOnFocusGain = false
                        publishState()
                    }
                }
            }}.build()
        return audioManager.requestAudioFocus(focusRequest!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonFocus() { focusRequest?.let(audioManager::abandonAudioFocusRequest); focusRequest = null }

    private fun publishState() {
        val snapshot = engine.snapshot()
        latestSnapshot = PlayerSnapshot(
            state = snapshot.state,
            positionMs = snapshot.positionMs,
            durationMs = snapshot.durationMs,
            error = engine.lastError()
        )
        val state = when (snapshot.state) {
            ENGINE_PLAYING -> PlaybackState.STATE_PLAYING
            ENGINE_PAUSED -> PlaybackState.STATE_PAUSED
            ENGINE_READY -> PlaybackState.STATE_BUFFERING
            ENGINE_STOPPED, ENGINE_IDLE -> PlaybackState.STATE_STOPPED
            else -> PlaybackState.STATE_NONE
        }
        session.setPlaybackState(PlaybackState.Builder().setActions(
            PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_STOP or
                PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_PLAY_FROM_URI
        ).setState(state, snapshot.positionMs.toLong(), if (state == PlaybackState.STATE_PLAYING) 1f else 0f,
            SystemClock.elapsedRealtime()).build())
        if (state == PlaybackState.STATE_PLAYING || state == PlaybackState.STATE_PAUSED) showNotification(state == PlaybackState.STATE_PLAYING)
        else if (foreground) { stopForeground(STOP_FOREGROUND_DETACH); foreground = false }
    }

    private fun showNotification(playing: Boolean) {
        val intent = Intent(this, NativePlaybackService::class.java).setAction(if (playing) ACTION_PAUSE else ACTION_PLAY)
        val pending = PendingIntent.getService(this, if (playing) 2 else 1, intent, PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL_ID).setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title).setContentText("Easy Player").setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true).addAction(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Pause" else "Play", pending)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken)).build()
        if (!foreground) { startForeground(NOTIFICATION_ID, notification); foreground = true }
        else getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

    private val sessionCallback = object : MediaSession.Callback() {
        override fun onPlay() { play() }
        override fun onPause() { pause() }
        override fun onStop() { stopPlayback() }
        override fun onSeekTo(pos: Long) { seek(pos.toDouble()) }
        override fun onPlayFromUri(uri: Uri?, extras: Bundle?) { uri?.path?.let { openAndPlay(it, extras?.getString(EXTRA_TITLE) ?: it.substringAfterLast('/')) } }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        handler.post { engine.close() }
        session.release(); abandonFocus(); thread.quitSafely()
        super.onDestroy()
    }

    private fun createNotificationChannel() = getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW)
    )

    companion object {
        const val ACTION_OPEN = "com.huiiro.easyplayer.action.OPEN"
        const val ACTION_PLAY = "com.huiiro.easyplayer.action.PLAY"
        const val ACTION_PAUSE = "com.huiiro.easyplayer.action.PAUSE"
        const val ACTION_STOP = "com.huiiro.easyplayer.action.STOP"
        const val ACTION_SEEK = "com.huiiro.easyplayer.action.SEEK"
        const val EXTRA_PATH = "path"; const val EXTRA_TITLE = "title"; const val EXTRA_POSITION_MS = "positionMs"
        private const val CHANNEL_ID = "easy_player_playback"; private const val NOTIFICATION_ID = 1001
        private const val POLL_MS = 500L; private const val DUCK_FACTOR = 0.2f
        private const val ENGINE_IDLE = 0; private const val ENGINE_READY = 2; private const val ENGINE_PLAYING = 3
        private const val ENGINE_PAUSED = 4; private const val ENGINE_STOPPED = 5
    }
}
