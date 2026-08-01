package com.librarium.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import app.tauri.backgroundservice.HeadlessBridge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // #64: tauri-plugin-background-service's LifecycleService always attempts
    // a native "headless core" JNI bridge on start/stop (unrelated to our
    // BackgroundService<R> usage — see headless_bridge_stub.rs's doc comment
    // for why this is required despite the plugin's own docs implying
    // otherwise). Point it at our real native lib name so the stub JNI
    // exports there resolve.
    HeadlessBridge.nativeLibName = "librarium_tauri_lib"
    super.onCreate(savedInstanceState)
  }
}
