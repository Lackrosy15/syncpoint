[CmdletBinding()]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$archivePath = $null
$client = $null
$form = $null
$response = $null
$settings = @{}
try {
    $envPath = Join-Path $PSScriptRoot '.env'
    if (Test-Path -LiteralPath $envPath) {
        foreach ($line in [IO.File]::ReadAllLines($envPath)) {
            if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
                $key = $matches[1]
                $value = $matches[2]
                if ($value.StartsWith('"') -or $value.StartsWith("'")) {
                    $end = $value.IndexOf($value.Substring(0, 1), 1)
                    if ($end -lt 0) { throw "Unclosed quote in .env for $key" }
                    $value = $value.Substring(1, $end - 1)
                } else { $value = ($value -replace '\s+#.*$', '').Trim() }
                $settings[$key] = $value
            }
        }
    }
    foreach ($key in @('SERVER_ID', 'VIBE_API_KEY', 'VIBE_BASE_URL', 'B24_DOMAIN')) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if (-not [string]::IsNullOrWhiteSpace($value)) { $settings[$key] = $value }
    }
    foreach ($key in @('SERVER_ID', 'VIBE_API_KEY', 'B24_DOMAIN')) {
        if ([string]::IsNullOrWhiteSpace($settings[$key])) { throw "Set $key in .env or the environment." }
    }
    $tar = (Get-Command tar.exe -ErrorAction Stop).Source
    foreach ($entry in @('src', 'package.json', 'package-lock.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $entry))) { throw "Missing required path: $entry" }
    }
    $archivePath = Join-Path ([IO.Path]::GetTempPath()) ("syncpoint-deploy-{0}.tar.gz" -f [Guid]::NewGuid())
    Write-Host 'Packaging application...'
    # Include runtime files only; keep local data and credentials out of the archive.
    & $tar -czf $archivePath -C $PSScriptRoot '--exclude=.env' '--exclude=*.env' '--exclude=.env.*' '--exclude=node_modules' src package.json package-lock.json
    if ($LASTEXITCODE -ne 0) { throw 'Could not create deployment archive.' }
    $entries = @(& $tar -tzf $archivePath)
    if ($LASTEXITCODE -ne 0 -or $entries -notcontains 'src/server.js') { throw 'Deployment archive validation failed.' }
    if ($DryRun) {
        Write-Host ("Dry run OK: {0} archive entries. No request sent." -f $entries.Count)
    } else {
        Add-Type -AssemblyName System.Net.Http
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $false
        $client = New-Object System.Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromMinutes(15)
        $client.DefaultRequestHeaders.Add('X-Api-Key', $settings['VIBE_API_KEY'])
        $form = New-Object System.Net.Http.MultipartFormDataContent
        $archiveContent = New-Object System.Net.Http.StreamContent([IO.File]::OpenRead($archivePath))
        $archiveContent.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/gzip')
        $form.Add($archiveContent, 'archive', 'app.tar.gz')
        $baseUrl = $settings['VIBE_BASE_URL']
        if (-not $baseUrl) { $baseUrl = 'https://vibecode.bitrix24.tech/v1' }
        $envJson = @{
            NODE_ENV = 'production'; PORT = '3000'
            VIBE_API_KEY = $settings['VIBE_API_KEY']; VIBE_BASE_URL = $baseUrl
            DATA_DIR = '/opt/data/syncpoint'; B24_DOMAIN = $settings['B24_DOMAIN']
        } | ConvertTo-Json -Compress
        $fields = @{
            runtime = 'node20'; install = 'cd /opt/app && npm ci --omit=dev'
            start = 'cd /opt/app && node src/server.js'; port = '3000'
            cleanDeploy = 'true'; env = $envJson
            preStart = 'cd /opt/app && node src/storage/migrateData.js'
            dataDirs = '["/opt/data/syncpoint"]'; dataDirsRecursive = 'true'
        }
        foreach ($key in $fields.Keys) {
            $form.Add((New-Object System.Net.Http.StringContent([string]$fields[$key])), $key)
        }
        $serverId = [Uri]::EscapeDataString($settings['SERVER_ID'])
        $url = "https://vibecode.bitrix24.tech/v1/infra/servers/$serverId/deploy?stream=false"
        Write-Host 'Uploading and deploying (this may take several minutes)...'
        $response = $client.PostAsync($url, $form).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw ("Deployment failed: HTTP {0}. Check VibeCode deployment logs." -f [int]$response.StatusCode) }
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if ($body.success -ne $true) { throw 'Deployment failed. Check VibeCode deployment logs.' }
        Write-Host ("Deployment successful: {0}" -f $body.data.appUrl) -ForegroundColor Green
    }
} catch {
    $message = $_.Exception.Message
    if ($settings['VIBE_API_KEY']) { $message = $message.Replace($settings['VIBE_API_KEY'], '[REDACTED]') }
    Write-Host $message -ForegroundColor Red
    exit 1
} finally {
    if ($response) { $response.Dispose() }
    if ($form) { $form.Dispose() }
    if ($client) { $client.Dispose() }
    if ($archivePath -and (Test-Path -LiteralPath $archivePath)) { Remove-Item -LiteralPath $archivePath -Force }
}
