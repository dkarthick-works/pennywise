plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "app.pennywise"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.pennywise"
        minSdk = 29 // MediaStore.Downloads, used for permission-free exports
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        setProperty("archivesBaseName", "pennywise")
        // Default to production so APKs work on real devices. For local development,
        // override with -PappUrl=http://10.0.2.2:8080 (Android emulator host).
        buildConfigField(
            "String",
            "APP_URL",
            "\"${project.findProperty("appUrl") ?: "https://wise.deeka.work"}\"",
        )
    }

    // One permanent key for every machine, so updates install over each other and keep
    // the login cookie. Key and passwords live outside the repo, in ~/.gradle/gradle.properties.
    signingConfigs {
        create("release") {
            storeFile = findProperty("pennywiseStoreFile")?.let { file(it) }
            storePassword = findProperty("pennywiseStorePassword") as String?
            keyAlias = findProperty("pennywiseKeyAlias") as String?
            keyPassword = findProperty("pennywiseKeyPassword") as String?
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.room:room-runtime:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
}
