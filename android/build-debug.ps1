param([string]$Architectures = 'arm64-v8a,x86_64')
$ErrorActionPreference = 'Stop'
$jdkPath = 'C:\Program Files\Java\jdk-17'
$sdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (!(Test-Path -LiteralPath (Join-Path $jdkPath 'bin\javac.exe'))) {
    throw 'JDK 17 not found. Update $jdkPath in this script.'
}
if (!(Test-Path -LiteralPath $sdkPath)) {
    throw 'Android SDK not found. Update $sdkPath in this script.'
}
$buildTemp = Join-Path $env:PUBLIC 'durak-build-temp'
New-Item -ItemType Directory -Path $buildTemp -Force | Out-Null
$projectRoot = Split-Path $PSScriptRoot -Parent
# Native Android tools need ASCII paths on Windows, including their dependency caches.
$buildRoot = Join-Path $env:PUBLIC 'durak-native-build'
$gradleCache = Join-Path $env:PUBLIC 'durak-gradle-cache'
$sdkAlias = Join-Path $env:PUBLIC 'durak-android-sdk'
foreach ($link in @(@($gradleCache, (Join-Path $env:USERPROFILE '.gradle')), @($sdkAlias, $sdkPath))) {
    if (!(Test-Path -LiteralPath $link[0])) {
        New-Item -ItemType Junction -Path $link[0] -Target $link[1] | Out-Null
    }
}
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
foreach ($directory in @('mobile', 'src', 'android')) {
    & robocopy (Join-Path $projectRoot $directory) (Join-Path $buildRoot $directory) /E /XD .git .gradle .cxx build /XF local.properties /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed: $directory" }
}
foreach ($file in @('package.json', 'package-lock.json', 'babel.config.js', 'metro.config.js', 'react-native.config.js')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $buildRoot -Force
}
$sdkProperty = 'sdk.dir=' + $sdkAlias.Replace('\', '/')
Set-Content -LiteralPath (Join-Path $buildRoot 'android\local.properties') -Value $sdkProperty -Encoding Ascii
$saved = @{}
foreach ($key in @('JAVA_HOME', 'ANDROID_HOME', 'GRADLE_USER_HOME', 'TEMP', 'TMP', 'JAVA_TOOL_OPTIONS')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
Push-Location $buildRoot
try {
    $env:JAVA_HOME = $jdkPath
    $env:ANDROID_HOME = $sdkAlias
    $env:GRADLE_USER_HOME = $gradleCache
    $env:TEMP = $buildTemp
    $env:TMP = $buildTemp
    $env:JAVA_TOOL_OPTIONS = ($saved['JAVA_TOOL_OPTIONS'] + ' -Djava.io.tmpdir=' + $buildTemp).Trim()
    $lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
    $stamp = Join-Path $buildRoot '.installed-lock-hash'
    if (!(Test-Path -LiteralPath 'node_modules\react-native\package.json') -or !(Test-Path -LiteralPath $stamp) -or (Get-Content -LiteralPath $stamp -Raw).Trim() -ne $lockHash) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        Set-Content -LiteralPath $stamp -Value $lockHash -Encoding Ascii
    }
    Set-Location (Join-Path $buildRoot 'android')
    & .\gradlew.bat assembleDebug --console=plain --no-daemon "-PreactNativeArchitectures=$Architectures"
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    $output = Join-Path $PSScriptRoot 'app\build\outputs\apk\debug'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $buildRoot 'android\app\build\outputs\apk\debug\app-debug.apk') -Destination $output -Force
    Write-Host "APK ready: $output\app-debug.apk"
} finally {
    Pop-Location
    foreach ($key in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
    }
}
