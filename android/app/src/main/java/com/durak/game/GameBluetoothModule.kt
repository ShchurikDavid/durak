package com.durak.game

import android.app.Activity
import android.bluetooth.*
import android.content.*
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class GameBluetoothPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(GameBluetoothModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

@Suppress("DEPRECATION", "MissingPermission")
class GameBluetoothModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "GameBluetooth"
    private val adapter get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private val uuid = UUID.fromString("33efa0b6-04ec-48ac-9c30-a92bf837593d")
    private val peers = ConcurrentHashMap<String, BluetoothSocket>()
    private val pool = Executors.newCachedThreadPool()
    private val writers = Executors.newSingleThreadExecutor()
    @Volatile private var server: BluetoothServerSocket? = null
    @Volatile private var pendingSocket: BluetoothSocket? = null
    @Volatile private var generation = 0
    private var pending: Promise? = null
    private val searchHandler = Handler(Looper.getMainLooper())
    @Volatile private var searching = false
    private var inquiryStarted = false
    private val searchTimeout = Runnable { finishSearch() }

    private fun emitDevice(device: BluetoothDevice) {
        if (!searching) return
        emit("device", device.address, device.name ?: "Устройство Bluetooth",
            device.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.PHONE)
    }
    private fun finishSearch() {
        if (!searching) return
        searching = false
        inquiryStarted = false
        searchHandler.removeCallbacks(searchTimeout)
        try { adapter?.cancelDiscovery() } catch (_: Exception) {}
        emit("scanEnd")
    }
    private val activityListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != 7181) return
            val promise = pending ?: return
            pending = null
            if (resultCode == Activity.RESULT_CANCELED) promise.reject("CANCELLED", "Запрос Bluetooth отменён")
            else promise.resolve(adapter?.name ?: "Телефон")
        }
    }
    private fun emit(type: String, id: String = "", value: String = "", isPhone: Boolean = false) {
        val map = Arguments.createMap().apply { putString("type", type); putString("id", id); putString("value", value); putBoolean("isPhone", isPhone) }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("durakBluetooth", map)
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                BluetoothDevice.ACTION_FOUND -> {
                    val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
                    emitDevice(device)
                }
                BluetoothAdapter.ACTION_DISCOVERY_STARTED -> if (searching) { inquiryStarted = true }
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> if (searching && inquiryStarted) { finishSearch() }
                BluetoothAdapter.ACTION_STATE_CHANGED -> if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_OFF) {
                    stopInternal(); emit("error", value = "Bluetooth выключен")
                }
            }
        }
    }
    init {
        context.addActivityEventListener(activityListener)
        val filter = IntentFilter().apply { addAction(BluetoothDevice.ACTION_FOUND); addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED); addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED); addAction(BluetoothAdapter.ACTION_STATE_CHANGED) }
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        else context.registerReceiver(receiver, filter)
    }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    @ReactMethod fun prepare(discoverable: Boolean, promise: Promise) {
        try {
            val bt = adapter ?: throw IllegalStateException("Этот телефон не поддерживает Bluetooth")
            if (pending != null) throw IllegalStateException("Завершите предыдущий запрос Android")
            if (!discoverable && bt.isEnabled) { promise.resolve(bt.name ?: "Телефон"); return }
            val activity = context.currentActivity ?: throw IllegalStateException("Откройте приложение")
            pending = promise
            val intent = if (discoverable) Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300) else Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            activity.runOnUiThread { try { activity.startActivityForResult(intent, 7181) } catch (e: Exception) { pending = null; promise.reject("BLUETOOTH", e.message) } }
        } catch (e: Exception) { promise.reject("BLUETOOTH", e.message) }
    }
    @ReactMethod fun scan(promise: Promise) {
        searchHandler.post { try {
            adapter.cancelDiscovery()
            searchHandler.removeCallbacks(searchTimeout)
            inquiryStarted = false
            searching = true
            // Like 2.4: show paired devices immediately, then incoming discovery
            // results. Device class is only a UI filter; no SDP probes or queues.
            adapter.bondedDevices.forEach { emitDevice(it) }
            if (!adapter.startDiscovery()) throw IllegalStateException("Не удалось начать поиск. Проверьте Bluetooth и геолокацию в настройках телефона.")
            searchHandler.postDelayed(searchTimeout, 30000)
            promise.resolve(null)
        } catch (e: Exception) { finishSearch(); promise.reject("BLUETOOTH", e.message) } }
    }
    private fun keepScreen(value: Boolean) { context.currentActivity?.let { activity -> activity.runOnUiThread { if (value) activity.window.addFlags(128) else activity.window.clearFlags(128) } } }
    @ReactMethod fun host(promise: Promise) {
        try {
            stopInternal()
            val listener = adapter.listenUsingRfcommWithServiceRecord("Durak", uuid)
            server = listener
            val token = generation
            keepScreen(true)
            pool.execute {
                try { while (generation == token) {
                    val socket = listener.accept()
                    if (generation != token || peers.size >= 3) socket.close() else attach(socket, token)
                } } catch (_: Exception) { if (generation == token && server === listener) emit("error", value = "Не удалось принять подключение") }
            }
            promise.resolve(null)
        } catch (e: Exception) { promise.reject("BLUETOOTH", e.message) }
    }
    // Closing the listening socket removes the SDP room advertisement;
    // already accepted connections continue their game normally.
    @ReactMethod fun stopHosting() {
        val listener = server
        server = null
        try { listener?.close() } catch (_: Exception) {}
    }
    @ReactMethod fun connect(address: String, promise: Promise) {
        stopInternal()
        val token = generation
        pool.execute {
            try {
                adapter.cancelDiscovery()
                val socket = adapter.getRemoteDevice(address).createRfcommSocketToServiceRecord(uuid)
                pendingSocket = socket
                socket.connect()
                if (token != generation) { socket.close(); throw IllegalStateException("Подключение отменено") }
                pendingSocket = null
                attach(socket, token)
                keepScreen(true)
                promise.resolve(null)
            } catch (e: Exception) { try { pendingSocket?.close() } catch (_: Exception) {}; pendingSocket = null; promise.reject("BLUETOOTH", "Не удалось подключиться. Пусть друг создаст стол и подтвердит сопряжение на телефоне.") }
        }
    }
    private fun attach(socket: BluetoothSocket, token: Int) {
        val id = socket.remoteDevice.address
        peers[id] = socket
        emit("connected", id)
        pool.execute {
            try {
                val input = socket.inputStream
                val buffer = java.io.ByteArrayOutputStream()
                while (generation == token) {
                    val byte = input.read()
                    if (byte == -1) break
                    if (byte == 10) { emit("message", id, buffer.toString("UTF-8")); buffer.reset() }
                    else { if (buffer.size() >= 65536) throw IllegalStateException("Packet too large"); buffer.write(byte) }
                }
            } catch (_: Exception) {} finally {
                try { socket.close() } catch (_: Exception) {}
                if (peers.remove(id, socket) && generation == token) emit("disconnected", id)
            }
        }
    }
    @ReactMethod fun send(id: String, value: String) {
        if (value.toByteArray(Charsets.UTF_8).size > 65536 || value.contains('\n')) return
        val socket = peers[id] ?: return
        writers.execute { try { socket.outputStream.write((value + "\n").toByteArray(Charsets.UTF_8)); socket.outputStream.flush() } catch (_: Exception) { try { socket.close() } catch (_: Exception) {} } }
    }
    private fun stopInternal() {
        generation++
        searching = false
        searchHandler.post {
            searchHandler.removeCallbacks(searchTimeout)
            inquiryStarted = false
        }
        try { adapter?.cancelDiscovery() } catch (_: Exception) {}
        try { server?.close() } catch (_: Exception) {}; server = null
        try { pendingSocket?.close() } catch (_: Exception) {}; pendingSocket = null
        peers.values.forEach { try { it.close() } catch (_: Exception) {} }; peers.clear()
        keepScreen(false)
    }
    @ReactMethod fun stop() { stopInternal() }
    override fun invalidate() { stopInternal(); context.unregisterReceiver(receiver); context.removeActivityEventListener(activityListener); pending?.reject("CLOSED", "Приложение закрыто"); pending = null; pool.shutdownNow(); writers.shutdownNow(); super.invalidate() }
}
