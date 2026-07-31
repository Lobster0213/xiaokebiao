import org.gradle.api.GradleException

plugins {
    id("com.android.application")
}

val configuredApplicationId = providers.gradleProperty("XIAOKEBIAO_APPLICATION_ID")
if (!configuredApplicationId.isPresent || configuredApplicationId.get().isBlank()) {
    throw GradleException(
        "缺少 XIAOKEBIAO_APPLICATION_ID。這是永久 Android 身分，請由專案擁有者確認後以 -PXIAOKEBIAO_APPLICATION_ID=... 提供。"
    )
}

val versionCodeValue = providers.gradleProperty("XIAOKEBIAO_VERSION_CODE").get().toInt()
val versionNameValue = providers.gradleProperty("XIAOKEBIAO_VERSION_NAME").get()
val keystorePath = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
val keystorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val keyAliasValue = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val keyPasswordValue = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull

android {
    namespace = "tw.xiaokebiao.shell"
    compileSdk = 35

    defaultConfig {
        applicationId = configuredApplicationId.get()
        minSdk = 26
        targetSdk = 35
        versionCode = versionCodeValue
        versionName = versionNameValue
    }

    signingConfigs {
        if (keystorePath != null && keystorePassword != null && keyAliasValue != null && keyPasswordValue != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                keyAlias = keyAliasValue
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }
}

val generatedWebAssets = layout.buildDirectory.dir("generated/webAssets")
val syncWebAssets by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile) {
        include("index.html")
        include("app-domain.js")
        include("manifest.webmanifest")
        include("app-icon.svg")
        include("icons/**")
    }
    into(generatedWebAssets)
}

android.sourceSets.getByName("main").assets.srcDir(generatedWebAssets)
tasks.named("preBuild").configure { dependsOn(syncWebAssets) }
tasks.matching { it.name == "packageRelease" }.configureEach {
    doFirst {
        if (keystorePath == null || keystorePassword == null || keyAliasValue == null || keyPasswordValue == null) {
            throw GradleException("Release 建置必須提供 ANDROID_KEYSTORE_PATH、ANDROID_KEYSTORE_PASSWORD、ANDROID_KEY_ALIAS、ANDROID_KEY_PASSWORD。")
        }
    }
}

dependencies {
    implementation("androidx.core:core:1.15.0")
}
