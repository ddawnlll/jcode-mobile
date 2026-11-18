package dev.ziran.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.ziran.android.design.Palette

/**
 * Hand-rolled back stack. Screen is a sealed value; the stack survives screen
 * unmounts because state lives in ViewModels. Predictive back and slide
 * transitions are step 5; step 1 proves navigation builds and runs.
 */
sealed interface Screen {
    object Start : Screen
    object Threads : Screen
    data class Thread(val sessionId: String) : Screen
    object Model : Screen
    object Scenes : Screen
}

@Composable
fun ZiranApp(deepLink: String? = null, palette: Palette = Palette.Day) {
    var stack by remember { mutableStateOf(listOf<Screen>(Screen.Start)) }
    val current = stack.last()
    when (val screen = current) {
        Screen.Start -> StartPlaceholder(palette = palette)
        Screen.Threads -> EmptyScreen("Threads", "Empty placeholder for step 1.", palette)
        is Screen.Thread -> EmptyScreen("Thread", "Empty placeholder for step 1.", palette)
        Screen.Model -> EmptyScreen("Model", "Empty placeholder for step 1.", palette)
        Screen.Scenes -> EmptyScreen("Scenes", "Empty placeholder for step 1.", palette)
    }
}
