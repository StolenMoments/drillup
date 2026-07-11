[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$androidRoot = Split-Path -Parent $PSScriptRoot
$keystoreDirectory = Join-Path $androidRoot 'keystore'
$keystorePath = Join-Path $keystoreDirectory 'drillup-release.jks'
$propertiesPath = Join-Path $androidRoot 'keystore.properties'

if ((Test-Path -LiteralPath $keystorePath) -or (Test-Path -LiteralPath $propertiesPath)) {
    throw '기존 keystore 또는 keystore.properties가 있어 덮어쓰지 않았습니다.'
}

function New-StrongPassword {
    $bytes = [byte[]]::new(48)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes)
}

$storePassword = New-StrongPassword
$keyPassword = New-StrongPassword
$keytool = (Get-Command keytool -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $keystoreDirectory -Force | Out-Null
try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $keytoolOutput = & $keytool `
        -genkeypair `
        -keystore $keystorePath `
        -alias drillup `
        -keyalg RSA `
        -keysize 4096 `
        -validity 10000 `
        -storetype JKS `
        -storepass $storePassword `
        -keypass $keyPassword `
        -dname 'CN=drillup, OU=Personal, O=mygreed, L=Seoul, ST=Seoul, C=KR' 2>&1
    $keytoolExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($keytoolExitCode -ne 0) {
        throw "keytool 실행에 실패했습니다(종료 코드: $keytoolExitCode)."
    }

    $properties = @(
        'storeFile=keystore/drillup-release.jks'
        "storePassword=$storePassword"
        'keyAlias=drillup'
        "keyPassword=$keyPassword"
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText($propertiesPath, $properties, [System.Text.UTF8Encoding]::new($false))
} catch {
    $ErrorActionPreference = 'Stop'
    Remove-Item -LiteralPath $keystorePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $propertiesPath -Force -ErrorAction SilentlyContinue
    throw
} finally {
    $storePassword = $null
    $keyPassword = $null
    $keytoolOutput = $null
}

Write-Host 'Release 서명 파일을 생성했습니다. 비밀번호는 keystore.properties에만 저장했습니다.'
Write-Host 'keystore와 keystore.properties를 안전한 별도 저장소에 함께 백업하세요.'
