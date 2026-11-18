param([string]$PublishDirectory = 'publish-iis-win-x64-fdd')
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$artifactRoot = Join-Path $workspace 'artifacts'
$publish = Join-Path $artifactRoot $PublishDirectory
$exe = Join-Path $publish 'SmartLaws.Web.exe'
if (!(Test-Path $exe)) { throw 'Publish output missing' }
[xml]$web = Get-Content (Join-Path $publish 'web.config') -Raw
$hosting = $web.configuration.location.'system.webServer'.aspNetCore
if ($hosting.processPath -ne '.\SmartLaws.Web.exe' -or $hosting.hostingModel -ne 'inprocess') { throw 'Unexpected IIS configuration' }
$runtime = Get-Content (Join-Path $publish 'SmartLaws.Web.runtimeconfig.json') -Raw | ConvertFrom-Json
if ($runtime.runtimeOptions.includedFrameworks -or !($runtime.runtimeOptions.frameworks | Where-Object { $_.name -eq 'Microsoft.AspNetCore.App' -and $_.version -like '10.*' })) { throw 'Expected framework-dependent ASP.NET Core 10 runtime reference' }
if (Test-Path -LiteralPath (Join-Path $publish 'coreclr.dll')) { throw 'Unexpected bundled runtime' }
$stream = [IO.File]::OpenRead($exe)
$reader = [IO.BinaryReader]::new($stream)
try { $stream.Position=0x3c; $offset=$reader.ReadInt32(); $stream.Position=$offset+4; if ($reader.ReadUInt16() -ne 0x8664) { throw 'EXE is not x64' } } finally { $reader.Dispose() }
$config = Get-Content (Join-Path $workspace 'appsettings.json') -Raw | ConvertFrom-Json
$localConnection = $config.ConnectionStrings.DefaultConnection
$config.ConnectionStrings.DefaultConnection = 'Server=SQL_SERVER;Database=DATABASE_NAME;User Id=SQL_LOGIN;Password=CHANGE_ME;Encrypt=True;TrustServerCertificate=False;'
[IO.File]::WriteAllText((Join-Path $publish 'appsettings.json'), ($config | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
$developmentSettings = Join-Path $publish 'appsettings.Development.json'
if (Test-Path -LiteralPath $developmentSettings) { Remove-Item -LiteralPath $developmentSettings }
Copy-Item -LiteralPath (Join-Path $workspace 'docs/IIS-INSTALL.txt') -Destination (Join-Path $publish 'IIS-INSTALL.txt')
Copy-Item -LiteralPath (Join-Path $workspace 'docs/CAPACITY.md') -Destination $publish
Copy-Item -Path (Join-Path $workspace 'docs/*.md') -Destination $publish
$capacityResult = Join-Path $artifactRoot 'capacity-800-200.json'
# Historical capacity measurements are described in CAPACITY.md.

Write-Output 'Package configuration prepared.'
# Smoke-test the actual published x64 executable; credentials remain process-local.
if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq 5099 }) { throw 'Test port 5099 already in use' }
$previousConnection = $env:ConnectionStrings__DefaultConnection
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT
$testId = [Guid]::NewGuid().ToString('N')
$testProcess = $null
try {
    $env:ConnectionStrings__DefaultConnection = $localConnection
    $env:ASPNETCORE_ENVIRONMENT = 'Production'
    $testProcess = Start-Process -FilePath $exe -ArgumentList '--urls','http://127.0.0.1:5099' -WorkingDirectory $publish -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifactRoot ('iis-smoke-' + $testId + '.stdout.log')) -RedirectStandardError (Join-Path $artifactRoot ('iis-smoke-' + $testId + '.stderr.log'))
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if ($testProcess.HasExited) { throw 'Published executable exited unexpectedly; inspect local smoke logs' }
        try { $response = Invoke-WebRequest 'http://127.0.0.1:5099/login.html' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200 -and $response.Content.Contains('authForm')) { $ready=$true; break } } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$ready) { throw 'Published executable did not become ready' }
    $asset = Invoke-WebRequest 'http://127.0.0.1:5099/js/judgment-library.js' -UseBasicParsing
    if (!$asset.Content.Contains('Judgment') -and !$asset.Content.Contains('judgment')) { throw 'Judgment library missing' }
    foreach ($assetName in @('court-tracking.js','appointments.js','studio-save.js','appointment-thai-dates.js','appointment-files.js','witness-pagination.js','court-form-editor.js','profile-autofill.js','pdf-viewer.js','multi-file-upload.js','case-management.js','case-parties.js','client-portal.js','client-desk.js','document-vault.js','lawyer-archive.js','special-procedures.js','community.js','office-team.js')) {
        $assetResponse = Invoke-WebRequest ('http://127.0.0.1:5099/js/' + $assetName) -UseBasicParsing
        if ($assetResponse.StatusCode -ne 200 -or $assetResponse.RawContentLength -lt 1000) { throw ('Asset missing: ' + $assetName) }
    }
    foreach ($assetPath in @('css/court-tracking.css','css/theme-palette.css','css/app-ui.css')) {
        if ((Invoke-WebRequest ('http://127.0.0.1:5099/' + $assetPath) -UseBasicParsing).StatusCode -ne 200) { throw ('Asset missing: ' + $assetPath) }
    }
    Write-Output 'PASS: x64 executable, framework-dependent runtime, IIS config, Production startup, login, judgment/calendar/PDF/upload assets'
} finally {
    if ($testProcess -and !$testProcess.HasExited) { Stop-Process -Id $testProcess.Id; $testProcess.WaitForExit() }
    $env:ConnectionStrings__DefaultConnection = $previousConnection
    $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
    $localConnection = $null
}
$zip = Join-Path $artifactRoot ('SmartLaws-IIS-win-x64-FDD-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($publish,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    foreach ($required in @('COURT-TRACKING.md','wwwroot/js/court-tracking.js','wwwroot/css/court-tracking.css','wwwroot/css/theme-palette.css','wwwroot/css/app-ui.css')) {
        if (!($archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $required })) { throw "ZIP missing $required" }
    }
    foreach ($required in @('web.config','SmartLaws.Web.exe','IIS-INSTALL.txt','APPOINTMENTS.md','OFFICE-TEAM.md','wwwroot/js/office-team.js','wwwroot/js/judgment-library.js','wwwroot/js/appointments.js','wwwroot/css/appointments.css','wwwroot/js/pdf-viewer.js','wwwroot/js/multi-file-upload.js','wwwroot/js/appointment-files.js','wwwroot/js/witness-pagination.js','wwwroot/css/witness-pagination.css','wwwroot/js/profile-autofill.js','wwwroot/js/appointment-thai-dates.js','wwwroot/js/studio-save.js','wwwroot/css/studio-save.css')) {
        if (!($archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $required })) { throw "ZIP missing $required" }
    }
    if ($archive.Entries | Where-Object { $_.FullName -match '(^|/)(artifacts|scripts|\.git)/|appsettings.Development.json' }) { throw 'Unexpected development files in ZIP' }
    Write-Output ('Verified ZIP entries: ' + $archive.Entries.Count)
} finally { $archive.Dispose() }
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
[IO.File]::WriteAllText($zip + '.sha256', $hash + '  ' + [IO.Path]::GetFileName($zip))
Get-Item -LiteralPath $zip | Select-Object FullName,Length
Write-Output ('SHA256: ' + $hash)
