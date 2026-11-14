package dev.jcode.stillness.native

import android.os.Build
import android.view.View
import android.view.ViewGroup
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Edge-to-edge inset reporting.
 *
 * The webview is padded by the system-bar and cutout insets only. The IME is
 * reported as data and left to `adjustResize`, so the composer is not pushed up
 * twice. The client receives an `insetsChanged` event and can also ask for the
 * current snapshot after startup.
 */
object LayoutState {
    data class InsetsData(
        val top: Int,
        val right: Int,
        val bottom: Int,
        val left: Int,
        val imeBottom: Int,
        val statusBar: Int,
        val navBar: Int,
    )

    data class LayoutStatusData(
        val edgeToEdge: Boolean,
        val imeVisible: Boolean,
        val predictiveBack: Boolean,
        val backStrategy: String,
        val insets: InsetsData,
    )

    @Volatile
    private var current = InsetsData(0, 0, 0, 0, 0, 0, 0)

    @Volatile
    private var imeVisible = false

    val edgeToEdge: Boolean = true
    val predictiveBack: Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val backStrategy: String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            "predictive_callback"
        } else {
            "back_dispatcher"
        }

    fun snapshot(): InsetsData = current

    fun status(): LayoutStatusData = LayoutStatusData(
        edgeToEdge = edgeToEdge,
        imeVisible = imeVisible,
        predictiveBack = predictiveBack,
        backStrategy = backStrategy,
        insets = current,
    )

    /**
     * Apply system-bar padding to the webview and publish the new insets.
     * Returns the insets that were applied.
     */
    fun apply(view: View, compat: WindowInsetsCompat): InsetsData {
        val bars = compat.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
        val ime = compat.getInsets(WindowInsetsCompat.Type.ime())
        val statusBar = compat.getInsets(WindowInsetsCompat.Type.statusBars()).top
        val navBar = compat.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
        // Margins rather than padding: the WebView renders through its own
        // surface, and padding on the view is not reflected in that surface on
        // every WebView version. Margins change the view bounds, which always
        // moves the visible page below the system bars.
        // The IME inset is added to the bottom margin: with edge-to-edge the
        // window is not resized for the keyboard on current releases, and the
        // focused field must stay above it. `adjustResize` remains declared for
        // older releases that still resize the window.
        val bottomInset = maxOf(bars.bottom, ime.bottom)
        val params = view.layoutParams
        if (params is ViewGroup.MarginLayoutParams) {
            if (params.leftMargin != bars.left || params.topMargin != bars.top ||
                params.rightMargin != bars.right || params.bottomMargin != bottomInset
            ) {
                params.setMargins(bars.left, bars.top, bars.right, bottomInset)
                view.layoutParams = params
            }
        }
        val next = InsetsData(
            top = bars.top,
            right = bars.right,
            bottom = bars.bottom,
            left = bars.left,
            imeBottom = ime.bottom,
            statusBar = statusBar,
            navBar = navBar,
        )
        val nextIme = compat.isVisible(WindowInsetsCompat.Type.ime())
        val changed = next != current || nextIme != imeVisible
        current = next
        imeVisible = nextIme
        if (changed) NativeEvents.emit("insetsChanged", status())
        return next
    }

    fun insetsFor(view: View): Insets = ViewCompat.getRootWindowInsets(view)
        ?.getInsets(WindowInsetsCompat.Type.systemBars())
        ?: Insets.NONE
}
