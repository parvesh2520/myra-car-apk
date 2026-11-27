plugins {
    id("com.android.application")
}

val cameraSender = providers.gradleProperty("cameraSender").orNull == "true"

android {
    namespace = "com.myra.car"
    compileSdk = 36
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = if (cameraSender) "com.myra.camerasender" else "com.myra.car"
        minSdk = 24 // Android 7.0, ONNX Runtime's minimum; the car runs Android 10
        targetSdk = 34
        versionCode = 15
        versionName = "3.3.0"
    }

    // One APK per CPU type: the car's head unit runs 32-bit Android (armeabi-v7a); arm64 for phones and newer units.
    // `-Pabis=x86_64` builds for the PC emulator (smoke tests).
    splits {
        abi {
            isEnable = !cameraSender
            reset()
            include(*((project.findProperty("abis") as String?) ?: "armeabi-v7a,arm64-v8a").split(",").toTypedArray())
            isUniversalApk = false
        }
    }

    signingConfigs {
        create("car") {
            // Expo's public debug key, the one the installed app was signed with. Demo builds only.
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
            enableV1Signing = true // some head-unit file managers only open v1-signed APKs
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("car")
        }
    }

    androidResources { noCompress += listOf("onnx", "tflite") }
    testOptions.unitTests.isReturnDefaultValues = true // SystemClock in PhoneFrames returns 0 in local tests
    sourceSets.getByName("main").apply {
        if (cameraSender) {
            manifest.srcFile("src/cameraSender/AndroidManifest.xml")
            assets.directories.clear()
        } else {
            assets.directories.add("../models")
        }
    }
    if (cameraSender) {
        packaging.jniLibs.excludes.addAll(listOf("**/libonnxruntime.so", "**/libonnxruntime4j_jni.so", "**/libtensorflowlite_jni.so"))
    }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.32.0")
    implementation("com.google.ai.edge.litert:litert:1.4.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517") // android's org.json is a stub in local unit tests
}
