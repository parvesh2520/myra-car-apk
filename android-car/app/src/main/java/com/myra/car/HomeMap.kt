package com.myra.car

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Point
import android.location.Location
import android.util.AttributeSet
import android.view.MotionEvent
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.util.MapTileIndex
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.Polyline

/**
 * Home navigation card: real street map (Esri World Dark Gray tiles, no API key or Play services),
 * centred on the car's position. A trip is shown, not driven: the route is drawn from the car to the destination.
 * Display only: it passes touches through.
 */
class HomeMap(context: Context, attrs: AttributeSet?) : MapView(context, attrs) {
    /** The last real GPS fix. */
    var position: GeoPoint? = null
        private set
    private var car: GeoPoint? = null // where the arrow is drawn: the GPS fix, or a point on the demo trip
    private var bearing = 0f
    private var end: GeoPoint? = null
    /** The saved home, marked on the map. */
    var home: GeoPoint? = null
        set(p) { field = p; invalidate() }

    /** Centres on [p] (e.g. a just-saved home); the next GPS fix moves back to the car. */
    fun look(p: GeoPoint) {
        if (end != null) return
        controller.setZoom(16.0)
        controller.setCenter(p)
    }
    private val line = Polyline(this).apply {
        outlinePaint.color = context.getColor(R.color.accent)
        outlinePaint.strokeWidth = 6 * resources.displayMetrics.density
        outlinePaint.strokeCap = Paint.Cap.ROUND
        isEnabled = false
    }

    init {
        setTileSource(object : OnlineTileSourceBase("EsriDarkGray", 0, 16, 256, "",
            arrayOf("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/")) {
            override fun getTileURLString(index: Long) =
                baseUrl + MapTileIndex.getZoom(index) + "/" + MapTileIndex.getY(index) + "/" + MapTileIndex.getX(index)
        })
        // Esri's grey, tinted navy to match the Myra UI home cards.
        overlayManager.tilesOverlay.setColorFilter(ColorMatrixColorFilter(ColorMatrix().apply { setScale(0.5f, 0.62f, 0.85f, 1f) }))
        overlayManager.tilesOverlay.loadingBackgroundColor = 0xFF0C1520.toInt()
        overlayManager.tilesOverlay.loadingLineColor = 0xFF0C1520.toInt()
        isTilesScaledToDpi = true
        zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
        setMultiTouchControls(false)
        controller.setZoom(5.0)
        controller.setCenter(GeoPoint(21.0, 78.9)) // India, until the first fix
        overlays.add(line)
        overlays.add(Markers())
    }

    fun show(location: Location) {
        val first = position == null
        position = GeoPoint(location.latitude, location.longitude)
        if (end != null) return // a trip is on screen: the real position waits until it is cleared
        car = position
        if (location.hasBearing()) bearing = location.bearing
        if (first) controller.setZoom(16.0)
        controller.setCenter(car)
        invalidate()
    }

    /** Draws [route] and frames it; the car arrow stays at the start, facing along the road. */
    fun drive(route: List<GeoPoint>) {
        clearTrip()
        end = route.last()
        line.setPoints(route)
        line.isEnabled = true
        car = route.first()
        val box = BoundingBox.fromGeoPoints(route)
        post {
            // A box with no size would zoom out to the whole world.
            if (box.latitudeSpan < 0.002 && box.longitudeSpanWithDateLine < 0.002) { controller.setZoom(16.0); controller.setCenter(box.centerWithDateLine) }
            else zoomToBoundingBox(box, false, (150 * resources.displayMetrics.density).toInt()) // clear of the nav bar and quick keys on top
        }
        if (route.size > 1) bearing = route[0].bearingTo(route[1]).toFloat()
        invalidate()
    }

    /** Back to following the car. */
    fun clearTrip() {
        if (end == null) return
        end = null
        line.isEnabled = false
        car = position
        position?.let { controller.setZoom(16.0); controller.setCenter(it) }
        invalidate()
    }

    override fun onTouchEvent(event: MotionEvent) = false

    private inner class Markers : Overlay() {
        private val d = resources.displayMetrics.density
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.getColor(R.color.accent) }
        private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.getColor(R.color.ink) }
        private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 2 * d; strokeJoin = Paint.Join.ROUND; color = context.getColor(R.color.ink)
        }
        private val p = Point()
        private val arrow = Path()
        private val house = context.getDrawable(R.drawable.ic_home)!!.mutate().apply { setTint(context.getColor(R.color.bg)) }

        override fun draw(c: Canvas, map: MapView, shadow: Boolean) {
            if (shadow) return
            home?.let {
                map.projection.toPixels(it, p)
                c.drawCircle(p.x.toFloat(), p.y.toFloat(), 13 * d, ink)
                val r = (8 * d).toInt()
                house.setBounds(p.x - r, p.y - r, p.x + r, p.y + r)
                house.draw(c)
            }
            end?.let {
                map.projection.toPixels(it, p)
                c.drawCircle(p.x.toFloat(), p.y.toFloat(), 8 * d, ink)
                c.drawCircle(p.x.toFloat(), p.y.toFloat(), 4 * d, fill)
            }
            val at = car ?: return
            map.projection.toPixels(at, p)
            val s = 11 * d
            arrow.reset()
            arrow.moveTo(0f, -s); arrow.lineTo(s * 0.75f, s * 0.7f); arrow.lineTo(0f, s * 0.3f); arrow.lineTo(-s * 0.75f, s * 0.7f); arrow.close()
            c.save()
            c.translate(p.x.toFloat(), p.y.toFloat())
            c.rotate(bearing - map.mapOrientation)
            c.drawPath(arrow, fill)
            c.drawPath(arrow, edge)
            c.restore()
        }
    }
}
