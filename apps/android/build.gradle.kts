plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.compose.compiler) apply false
}

tasks.register("clean").configure {
    delete(layout.buildDirectory)
}
