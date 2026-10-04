package com.durak.game

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(applicationContext, PackageList(this).packages.apply { add(GameAudioPackage()); add(GameBluetoothPackage()); add(GameHapticsPackage()) }, useDevSupport = false)
    }
    override fun onCreate() { super.onCreate(); loadReactNative(this) }
}

