plugins {
    java
    id("xyz.jpenilla.run-paper") version "2.3.0"
}

group = "com.deehain.smp"
version = "1.0.0"

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(21))
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://repo.extendedclip.com/content/repositories/placeholderapi/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.20.4-R0.1-SNAPSHOT")
    compileOnly("me.clip:placeholderapi:2.11.5")
    compileOnly("com.google.code.gson:gson:2.10.1")
}

tasks.processResources {
    filesMatching("plugin.yml") {
        expand("version" to project.version)
    }
}

tasks.jar {
    archiveBaseName.set("Kingdomsmp-playermanager")
    archiveVersion.set("")
}

tasks.runServer {
    minecraftVersion("1.21.10")
}
