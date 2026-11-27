package com.myra.car

import android.os.SystemClock
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.BindException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom

internal const val CAMERA_PORT = 8787
private const val MAX_JPEG = 512 * 1024
/** Protocol 2: one connection, the phone pushes every new frame. Protocol 1 (one request per frame) is gone. */
private const val HELLO = "MYRA-CAM2"
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

/** The car's side: a live stream of the phone's frames. [close] from any thread ends a blocked [next]. */
internal class PhoneStream(phone: PhoneEndpoint) : Closeable {
    private val socket = Socket()
    private val input: DataInputStream

    init {
        try {
            socket.tcpNoDelay = true
            socket.receiveBufferSize = 256 * 1024
            socket.connect(InetSocketAddress(phone.address, phone.port), 1800)
            socket.soTimeout = 2500 // the phone sends ~30 frames a second; this long without one means it is gone
            DataOutputStream(socket.getOutputStream()).apply { writeUTF(HELLO); writeUTF(phone.code); flush() }
            input = DataInputStream(BufferedInputStream(socket.getInputStream(), 64 * 1024))
            if (input.readUnsignedByte() != 1) {
                throw IllegalStateException("Check the camera code on the phone, and that the phone has the latest Myra Phone Camera.")
            }
        } catch (e: Throwable) {
            socket.close()
            throw e
        }
    }

    fun next(): CameraFrame {
        val id = input.readLong()
        val rotation = input.readUnsignedShort()
        val length = input.readInt()
        check(rotation in 0..270 && rotation % 90 == 0 && length in 1..MAX_JPEG) { "Invalid camera frame" }
        return CameraFrame(id, rotation, ByteArray(length).also(input::readFully))
    }

    override fun close() = socket.close()
}

/**
 * The phone's side: pushes each new JPEG to the connected car. A car that reads slower simply gets the newest frame
 * when it is ready (no queue builds up). There is no file and no internet connection.
 */
internal class PhoneFrameServer : Closeable {
    val code = SecureRandom().nextInt(100_000_000).toString().padStart(8, '0')
    private val listener = try { listen(CAMERA_PORT) } catch (_: BindException) { listen(0) }
    val port get() = listener.localPort
    val isListening get() = !listener.isClosed
    private val lock = Object()
    @Volatile private var activeClient: Socket? = null
    @Volatile var latest: CameraFrame? = null; private set
    /** Frames written to the car during the last second. */
    @Volatile var sentPerSecond = 0; private set

    init {
        Thread({
            try {
                while (!listener.isClosed) {
                    val client = runCatching { listener.accept() }.getOrNull() ?: break
                    // One car at a time; a reconnecting car replaces a connection that may be dead but not yet timed out.
                    activeClient?.close()
                    activeClient = client
                    Thread({
                        client.use { runCatching { serve(it) } }
                        if (activeClient === client) sentPerSecond = 0
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
        socket.sendBufferSize = 256 * 1024
        val input = DataInputStream(socket.getInputStream())
        val hello = input.readUTF()
        val supplied = input.readUTF()
        val output = DataOutputStream(BufferedOutputStream(socket.getOutputStream(), 64 * 1024))
        if (hello != HELLO || !MessageDigest.isEqual(code.toByteArray(), supplied.toByteArray())) {
            output.writeByte(2)
            output.flush()
            return
        }
        output.writeByte(1)
        output.flush()
        var sent = Long.MIN_VALUE
        var count = 0
        var second = SystemClock.elapsedRealtime()
        while (!listener.isClosed && activeClient === socket) {
            val frame = synchronized(lock) {
                if (latest.let { it == null || it.id == sent }) lock.wait(500)
                latest
            }
            val now = SystemClock.elapsedRealtime()
            if (now - second >= 1000) { sentPerSecond = count; count = 0; second = now }
            if (frame == null || frame.id == sent || now - frame.id > STALE_MS) continue
            output.writeLong(frame.id)
            output.writeShort(frame.rotation)
            output.writeInt(frame.jpeg.size)
            output.write(frame.jpeg)
            output.flush()
            sent = frame.id
            count++
        }
    }

    override fun close() {
        listener.close()
        activeClient?.close()
        activeClient = null
        synchronized(lock) { latest = null; lock.notifyAll() }
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
        if (listOf("ap", "swlan", "rndis", "usb", "ncm").any(name::startsWith)) 0 else 1
    }
    .flatMap { it.inetAddresses.toList() }
    .filter { it.isCameraAddress() && !it.isLoopbackAddress }
    .mapNotNull { it.hostAddress }
    .distinct()
