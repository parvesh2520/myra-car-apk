package com.myra.car

import android.net.ConnectivityManager
import android.net.Network
import android.os.SystemClock
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.BindException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom

internal const val CAMERA_PORT = 8787
private const val MAX_JPEG = 512 * 1024
/** Protocol 3: one connection; the car asks for one photo at a time and analyzes it before asking again. */
private const val HELLO = "MYRA-CAM3"
private const val STALE_MS = 1000L

internal class CameraFrame(val id: Long, val rotation: Int, val jpeg: ByteArray)

internal data class PhoneEndpoint(val address: InetAddress, val port: Int, val code: String) {
    companion object {
        fun parse(host: String, code: String): PhoneEndpoint? {
            val endpoint = host.trim().split(':', limit = 2)
            val parts = endpoint[0].split('.')
            val port = if (endpoint.size == 1) CAMERA_PORT else endpoint[1].toIntOrNull()?.takeIf { it in 1024..65535 }
                ?: return null
            if (parts.size != 4 || !code.matches(Regex("[0-9]{8}"))) return null
            val octets = parts.map { it.toIntOrNull()?.takeIf { n -> n in 0..255 } ?: return null }
            val address = InetAddress.getByAddress(octets.map(Int::toByte).toByteArray())
            if (!address.isCameraAddress()) return null
            return PhoneEndpoint(address, port, code)
        }
    }
}

/** The car's side: asks the phone for one photo at a time. [close] from any thread ends a blocked [next]. */
internal class PhoneStream(phone: PhoneEndpoint, network: Network? = null) : Closeable {
    private val socket = Socket()
    private val input: DataInputStream
    private val output: DataOutputStream

    init {
        try {
            socket.tcpNoDelay = true
            socket.receiveBufferSize = 48 * 1024
            network?.bindSocket(socket)
            socket.connect(InetSocketAddress(phone.address, phone.port), 1800)
            socket.soTimeout = 2500 // the phone answers a photo request within ~1 s
            output = DataOutputStream(socket.getOutputStream()).apply { writeUTF(HELLO); writeUTF(phone.code); flush() }
            input = DataInputStream(BufferedInputStream(socket.getInputStream(), 64 * 1024))
            val status = try {
                input.readUnsignedByte()
            } catch (e: SocketTimeoutException) {
                throw IOException("The phone answered, but camera pairing timed out. Update both MYRA apps.", e)
            }
            if (status != 1) throw IllegalStateException("Camera code rejected. Enter the current 8-digit code shown on the phone.")
        } catch (e: Throwable) {
            socket.close()
            throw e
        }
    }

    /** Requests the phone's newest photo and waits for it. */
    fun next(): CameraFrame {
        output.writeByte(1)
        output.flush()
        val id = input.readLong()
        val rotation = input.readUnsignedShort()
        val length = input.readInt()
        check(rotation in 0..270 && rotation % 90 == 0 && length in 1..MAX_JPEG) { "Invalid camera frame" }
        return CameraFrame(id, rotation, ByteArray(length).also(input::readFully))
    }

    override fun close() = socket.close()
}

/** Prefer a directly connected tether or Wi-Fi subnet over Android's default internet route. */
@Suppress("DEPRECATION")
internal fun cameraNetwork(manager: ConnectivityManager?, phone: PhoneEndpoint): Network? {
    if (manager == null || phone.address.isLoopbackAddress) return null
    return manager.allNetworks.mapNotNull { network ->
        val prefix = manager.getLinkProperties(network)?.routes
            ?.filter { it.gateway?.isAnyLocalAddress != false && !it.isDefaultRoute && it.matches(phone.address) }
            ?.maxOfOrNull { it.destination.prefixLength }
        prefix?.let { network to it }
    }.maxByOrNull { it.second }?.first
}

/**
 * The phone's side: answers each photo request from the connected car with the newest JPEG, so the car only ever
 * gets the photo it is about to analyze. There is no file and no internet connection.
 */
internal class PhoneFrameServer : Closeable {
    val code = SecureRandom().nextInt(100_000_000).toString().padStart(8, '0')
    private val listener = try { listen(CAMERA_PORT) } catch (_: BindException) { listen(0) }
    val port get() = listener.localPort
    val isListening get() = !listener.isClosed
    private val lock = Object()
    @Volatile private var activeClient: Socket? = null
    @Volatile var latest: CameraFrame? = null; private set
    /** When the last photo was sent to the car (elapsedRealtime), 0 if none yet. */
    @Volatile var lastSent = 0L; private set
    val paired get() = activeClient != null

    init {
        Thread({
            try {
                while (!listener.isClosed) {
                    val client = runCatching { listener.accept() }.getOrNull() ?: break
                    Thread({
                        client.use { runCatching { serve(it) } }
                        synchronized(lock) {
                            if (activeClient === client) activeClient = null
                        }
                    }, "phone-camera-client").start()
                }
            } finally {
                listener.close()
            }
        }, "phone-camera").start()
    }

    fun publish(frame: CameraFrame) = synchronized(lock) {
        latest = frame
        lock.notifyAll()
    }

    private fun serve(socket: Socket) {
        if (!socket.inetAddress.isCameraAddress()) return
        socket.soTimeout = 800
        socket.tcpNoDelay = true
        socket.sendBufferSize = 48 * 1024
        val input = DataInputStream(socket.getInputStream())
        val hello = input.readUTF()
        val supplied = input.readUTF()
        val output = DataOutputStream(BufferedOutputStream(socket.getOutputStream(), 64 * 1024))
        if (hello != HELLO || !MessageDigest.isEqual(code.toByteArray(), supplied.toByteArray())) {
            output.writeByte(2)
            output.flush()
            return
        }
        synchronized(lock) {
            if (listener.isClosed) return
            activeClient?.close()
            activeClient = socket
            lock.notifyAll()
        }
        output.writeByte(1)
        output.flush()
        socket.soTimeout = 30_000 // the car asks again only after analyzing the last photo
        var sent = Long.MIN_VALUE
        while (!listener.isClosed && activeClient === socket) {
            if (input.read() != 1) return
            val deadline = SystemClock.elapsedRealtime() + 2000
            val frame = synchronized(lock) {
                fun fresh(f: CameraFrame?) = f != null && f.id != sent && SystemClock.elapsedRealtime() - f.id <= STALE_MS
                while (!fresh(latest) && activeClient === socket && SystemClock.elapsedRealtime() < deadline) lock.wait(100)
                latest.takeIf(::fresh)
            } ?: return // no fresh photo: the car reconnects
            output.writeLong(frame.id)
            output.writeShort(frame.rotation)
            output.writeInt(frame.jpeg.size)
            output.write(frame.jpeg)
            output.flush()
            sent = frame.id
            lastSent = SystemClock.elapsedRealtime()
        }
    }

    override fun close() {
        listener.close()
        synchronized(lock) {
            activeClient?.close()
            activeClient = null
            latest = null
            lock.notifyAll()
        }
    }
}

private fun listen(port: Int) = ServerSocket().let { socket ->
    try {
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(port))
        socket
    } catch (error: java.io.IOException) {
        socket.close()
        throw error
    }
}

private fun InetAddress.isCameraAddress() = address.size == 4 && (isSiteLocalAddress || isLinkLocalAddress || isLoopbackAddress)

internal fun phoneAddresses(): List<String> = NetworkInterface.getNetworkInterfaces().toList()
    .filter { it.isUp && !it.isLoopback }
    .filterNot { it.name.startsWith("tun") || it.name.contains("rmnet") || it.name.startsWith("ccmni") }
    .sortedBy { iface ->
        val name = iface.name
        when {
            listOf("rndis", "usb", "ncm", "eth").any(name::startsWith) -> 0
            listOf("ap", "swlan", "softap", "wlan").any(name::startsWith) -> 1
            else -> 2
        }
    }
    .flatMap { it.inetAddresses.toList() }
    .filter { it.isCameraAddress() && !it.isLoopbackAddress }
    .mapNotNull { it.hostAddress }
    .distinct()
