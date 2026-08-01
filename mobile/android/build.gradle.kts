allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

// Fix for legacy plugins missing the namespace attribute required by AGP 8.0+
subprojects {
    project.plugins.withId("com.android.library") {
        project.extensions.configure<com.android.build.api.dsl.LibraryExtension>("android") {
            if (namespace == null) {
                namespace = project.group.toString()
            }
        }
    }
}

// Master JVM Enforcer: Explicitly target legacy plugins by name for Kotlin 11, and force Kotlin 17 on everything else
subprojects {
    project.extra.set("compileSdkVersion", 35)
    project.extra.set("targetSdkVersion", 35)

    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        if (project.name == "telephony" || project.name == "volume_controller") {
            compilerOptions {
                jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
            }
        } else {
            compilerOptions {
                jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
            }
        }
    }
}
