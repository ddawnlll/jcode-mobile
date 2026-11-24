# Ziran 0.7.3 R8 keep rules — keeps protocol serialization, OkHttp, and Compose runtime intact.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# kotlinx.serialization
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class * {
    public static kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class dev.ziran.android.protocol.**$$serializer { *; }
-keepclassmembers class dev.ziran.android.protocol.** {
    *** Companion;
}
-keepclasseswithmembers class dev.ziran.android.protocol.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp / Conscrypt optional platform bindings
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
