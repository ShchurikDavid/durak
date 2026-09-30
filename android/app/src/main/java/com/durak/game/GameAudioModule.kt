package com.durak.game

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

class GameAudioModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    private val handler = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private var player: MediaPlayer? = null
    private var pool: SoundPool? = null
    private val effects = mutableMapOf<String, Int>()
    private val loaded = mutableSetOf<Int>()
    private var music = false
    private var sounds = true
    private var musicVolume = .03f
    private var soundVolume = 1f
    private var active = true
    private var focused = false
    private var invalid = false
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(attributes).setOnAudioFocusChangeListener({ change ->
            focused = change == AudioManager.AUDIOFOCUS_GAIN
            if (focused) updateMusic() else { player?.pause(); pool?.autoPause() }
        }, handler).build()

    init { context.addLifecycleEventListener(this) }
    override fun getName() = "GameAudio"
    private fun post(block: () -> Unit) { handler.post { if (!invalid) block() } }
    private fun acquire(): Boolean {
        if (!active) return false
        if (!focused) focused = manager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return focused
    }
    private fun prepare() {
        if (pool != null) return
        pool = SoundPool.Builder().setMaxStreams(4).setAudioAttributes(attributes).build().apply {
            setOnLoadCompleteListener { _, id, status -> if (status == 0) handler.post { loaded.add(id) } }
            effects["play"] = load(context, R.raw.card_play, 1)
            effects["defend"] = load(context, R.raw.card_defend, 1)
            effects["take"] = load(context, R.raw.card_take, 1)
        }
    }
    private fun updateMusic() {
        if (!active || !music || musicVolume == 0f) { player?.pause(); return }
        if (!acquire()) return
        if (player == null) {
            player = MediaPlayer.create(context, R.raw.bg_music, attributes, 0)?.apply { isLooping = true }
        }
        player?.setVolume(musicVolume, musicVolume)
        player?.start()
    }
    @ReactMethod fun configure(musicOn: Boolean, soundsOn: Boolean, musicLevel: Double, soundLevel: Double) = post {
        music = musicOn; sounds = soundsOn
        musicVolume = musicLevel.toFloat().coerceIn(0f, 1f)
        soundVolume = soundLevel.toFloat().coerceIn(0f, 1f)
        prepare(); updateMusic()
        if (!sounds) pool?.autoPause()
        if (!music && !sounds) { manager.abandonAudioFocusRequest(focus); focused = false }
    }
    @ReactMethod fun play(action: String) = post {
        if (!sounds || soundVolume == 0f || !acquire()) return@post
        prepare()
        val key = when(action) {
            "defend" -> "defend"
            "take", "bito", "start", "gameOver", "timeout-take", "timeout-bito" -> "take"
            else -> "play"
        }
        effects[key]?.let { if (loaded.contains(it)) pool?.play(it, soundVolume, soundVolume, 1, 0, 1f) }
    }
    @ReactMethod fun stop() = post { music = false; player?.pause(); pool?.autoPause(); manager.abandonAudioFocusRequest(focus); focused = false }
    override fun onHostResume() = post { active = true; updateMusic() }
    override fun onHostPause() = post { active = false; player?.pause(); pool?.autoPause(); manager.abandonAudioFocusRequest(focus); focused = false }
    override fun onHostDestroy() = onHostPause()
    override fun invalidate() {
        context.removeLifecycleEventListener(this)
        handler.post { invalid = true; player?.release(); player = null; pool?.release(); pool = null; manager.abandonAudioFocusRequest(focus) }
        super.invalidate()
    }
}

class GameAudioPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(GameAudioModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
