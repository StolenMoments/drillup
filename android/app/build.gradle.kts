plugins {
    id("com.android.application")
}

android {
    namespace = "shop.mygreed.drillup"
    compileSdk = 36

    defaultConfig {
        applicationId = "shop.mygreed.drillup"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.webkit:webkit:1.16.0")

    testImplementation("junit:junit:4.13.2")
}
