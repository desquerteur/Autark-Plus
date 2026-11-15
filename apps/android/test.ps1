# Owns: small host-side Java tests. Never: substitutes for a real Android device test.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin' } else { '' }
$javac = if ($java) { Join-Path $java 'javac.exe' } else { 'javac' }
$runtime = if ($java) { Join-Path $java 'java.exe' } else { 'java' }
# The same BouncyCastle the app bundles (app/build.gradle), from Gradle's cache after the first build resolved it.
$bc = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1/org.bouncycastle/bcprov-jdk18on/1.79') -Recurse -Filter 'bcprov-jdk18on-1.79.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $bc) { throw 'bcprov-jdk18on-1.79.jar is not in the Gradle cache yet; run the Gradle build once.' }
# ZXing core for pair/QrDecode (app/build.gradle): Gradle's cache after a build, else build/test-libs/core-3.5.3.jar
# (fetched once from https://repo1.maven.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar, sha1 ca1349214a356cd7958651b2d5a0e1f3811a9c4b).
$zx = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1/com.google.zxing/core/3.5.3') -Recurse -Filter 'core-3.5.3.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $zx) { $zx = Get-Item (Join-Path $root 'build/test-libs/core-3.5.3.jar') -ErrorAction SilentlyContinue }
if (-not $zx) { throw 'core-3.5.3.jar (ZXing) is neither in the Gradle cache nor in apps/android/build/test-libs; run the Gradle build once.' }
$libs = "$($bc.FullName);$($zx.FullName)"
$out = Join-Path $root 'app/build/host-tests'
New-Item -ItemType Directory -Force $out | Out-Null
# relay/ is pure Java except NetworkWake (Android's network callback), which a phone exercises.
$sources = @(Get-ChildItem (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/relay') -Filter '*.java' | Where-Object Name -ne 'NetworkWake.java' | ForEach-Object FullName) +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/ConnectionAddress.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/Companies.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/CssColor.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/PhoneRoutes.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/ScreenTree.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/Gestures.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/DisclosureText.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/StepThread.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/TypedText.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/UseState.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/phoneuse/TypeTarget.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/InstallSource.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/UpdateRelease.java') +
    (Join-Path $root 'app/src/main/java/com/teydralab/autark/android/pair/QrDecode.java') +
    @(Get-ChildItem (Join-Path $root 'test') -Filter '*.java' | ForEach-Object FullName) +
    @(Get-ChildItem (Join-Path $root 'test/phoneuse') -Filter '*.java' | ForEach-Object FullName) +
    @(Get-ChildItem (Join-Path $root 'test/pair') -Filter '*.java' | ForEach-Object FullName) +
    @(Get-ChildItem (Join-Path $root 'test/routes') -Filter '*.java' | ForEach-Object FullName) +
    @(Get-ChildItem (Join-Path $root 'test/relay') -Filter '*.java' -ErrorAction SilentlyContinue | ForEach-Object FullName)
& $javac -encoding UTF-8 -Xlint:all -cp $libs -d $out @sources
if ($LASTEXITCODE -ne 0) { throw 'Host test compilation failed.' }
$classpath = "$out;$libs"
# B-078: the SAS interop vectors (desktop remote/sas.ts) and phone use's screen tree and gestures run here too.
foreach ($test in 'ConnectionAddressTest', 'RelayCryptoTest', 'relay.RemotePairTest', 'phoneuse.ScreenTreeTest', 'phoneuse.DisclosureTest', 'phoneuse.UseLinkThreadTest', 'phoneuse.TypedTextTest', 'phoneuse.UseStateTest', 'phoneuse.TypeTargetTest', 'UpdateReleaseTest', 'pair.QrDecodeTest', 'CompaniesTest', 'CssColorTest', 'relay.ReconnectTest', 'relay.CodeChainTest', 'relay.LinksTest', 'PhoneRoutesTest') {
    # autark.android: UpdateReleaseTest reads UpdateCheck/SelfUpdate's wiring from the sources.
    & $runtime "-Dautark.android=$root" -cp $classpath "com.teydralab.autark.android.$test"
    if ($LASTEXITCODE -ne 0) { throw "Host test $test failed." }
}
