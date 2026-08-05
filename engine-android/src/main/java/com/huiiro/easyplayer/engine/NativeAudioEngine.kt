package com.huiiro.easyplayer.engine

import androidx.annotation.Keep

/**
 * Thread-confined JNI bridge. Invoke from the player service's single-thread
 * dispatcher; UI state is obtained by polling [snapshot] from that service.
 */
@Keep
class NativeAudioEngine : AutoCloseable {
    private var handle: Long = nativeCreate()

    fun open(path: String): Boolean = withHandle { nativeOpen(it, path) }
    fun play(): Boolean = withHandle { nativePlay(it) }
    fun pause(): Boolean = withHandle { nativePause(it) }
    fun stop(): Boolean = withHandle { nativeStop(it) }
    fun seek(positionMs: Double): Boolean = withHandle { nativeSeek(it, positionMs) }
    fun setVolume(volume: Float) = withHandle { nativeSetVolume(it, volume.coerceIn(0f, 1f)) }
    fun snapshot(): Snapshot = withHandle {
        Snapshot(nativeGetState(it), nativeGetPositionMs(it), nativeGetDurationMs(it))
    }
    fun lastError(): String? = withHandle { nativeGetLastError(it) }
    fun readEmbeddedLyrics(path: String): String? = nativeReadEmbeddedLyrics(path)

    override fun close() {
        if (handle != 0L) nativeDestroy(handle)
        handle = 0L
    }

    private inline fun <T> withHandle(block: (Long) -> T): T {
        check(handle != 0L) { "NativeAudioEngine is closed" }
        return block(handle)
    }

    data class Snapshot(val state: Int, val positionMs: Double, val durationMs: Double)

    private external fun nativeCreate(): Long
    private external fun nativeDestroy(handle: Long)
    private external fun nativeOpen(handle: Long, path: String): Boolean
    private external fun nativePlay(handle: Long): Boolean
    private external fun nativePause(handle: Long): Boolean
    private external fun nativeStop(handle: Long): Boolean
    private external fun nativeSeek(handle: Long, positionMs: Double): Boolean
    private external fun nativeSetVolume(handle: Long, volume: Float)
    private external fun nativeGetState(handle: Long): Int
    private external fun nativeGetPositionMs(handle: Long): Double
    private external fun nativeGetDurationMs(handle: Long): Double
    private external fun nativeGetLastError(handle: Long): String?
    private external fun nativeReadEmbeddedLyrics(path: String): String?

    private companion object {
        init { System.loadLibrary("easy_player_engine_android") }
    }
}
