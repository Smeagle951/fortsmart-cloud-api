param([string]$BaseUrl=$env:BASE_URL,[string]$ApiKey=$env:API_KEY)
$ErrorActionPreference="Stop"
if(-not $BaseUrl){throw "BASE_URL"}
if(-not $ApiKey){throw "API_KEY"}
$p=Join-Path $PSScriptRoot "push-base-minimal.payload.json"
$b=Get-Content -Raw -Encoding UTF8 $p
$h=@{"Authorization"="Bearer $ApiKey";"Content-Type"="application/json"}
$url="$($BaseUrl.TrimEnd('/'))/sync/base/push"
Invoke-RestMethod -Uri $url -Method Post -Headers $h -Body $b | ConvertTo-Json -Depth 20
