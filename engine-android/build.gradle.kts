import com.android.build.api.dsl.LibraryExtension
import org.gradle.kotlin.dsl.configure
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension
import java.util.Properties

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

val localProperties = Properties().apply {
    val localPropertiesFile = rootProject.file("local.properties")
    if (localPropertiesFile.isFile) {
        localPropertiesFile.inputStream().use(::load)
    }
}

extensions.configure<LibraryExtension> {
    namespace = "com.huiiro.easyplayer.engine"
    compileSdk = 36
    // Keep native builds reproducible. AGP has installed this side-by-side NDK
    // during the first engine configuration on the development machine.
    ndkVersion = "27.0.12077973"

    defaultConfig {
        minSdk = 28
        ndk {
            // First release defaults to arm64-v8a. Development builds can
            // override this with -PeasyPlayerAndroidAbis=x86_64.
            val abis = (providers.gradleProperty("easyPlayerAndroidAbis").orNull
                ?: localProperties.getProperty("easyPlayerAndroidAbis"))
                ?.split(',')?.map(String::trim)?.filter(String::isNotEmpty)
                ?: listOf("arm64-v8a")
            abiFilters += abis
        }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
                val depsRoot = providers.gradleProperty("easyPlayerAndroidDepsRoot").orNull
                    ?: providers.environmentVariable("EASY_PLAYER_ANDROID_DEPS_ROOT").orNull
                    ?: localProperties.getProperty("easyPlayerAndroidDepsRoot")
                if (depsRoot != null) {
                    arguments += "-DEASY_PLAYER_ANDROID_DEPS_ROOT=$depsRoot"
                }
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildFeatures { buildConfig = false }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

extensions.configure<KotlinAndroidProjectExtension> {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.annotation:annotation:1.9.1")
}
