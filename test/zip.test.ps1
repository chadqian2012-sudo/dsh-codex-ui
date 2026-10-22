[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$distRoot=[IO.Path]::GetFullPath((Join-Path $root 'dist'))
$output=[IO.Path]::GetFullPath((Join-Path $distRoot ('zip-validation-'+[guid]::NewGuid().ToString('N'))))
if (-not $output.StartsWith($distRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test output' }
$manifest=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$passed=0
function Assert([bool]$ok,[string]$label){if(-not $ok){throw "FAIL: $label"};$script:passed++;Write-Host "PASS: $label"}
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'pack-dist.ps1') -OutDir $output | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ZIP build failed' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead((Join-Path $output ($manifest.name+'-'+$manifest.version+'.zip')))
  try {
    $prefix=$manifest.name+'/'
    $entries=@($archive.Entries)
    Assert (@($entries | Where-Object { $_.FullName.Contains('\') -or -not $_.FullName.StartsWith($prefix) -or $_.FullName.Contains('../') }).Count -eq 0) 'ZIP uses portable forward-slash package paths'
    Assert (@($entries | Where-Object { $_.FullName -match '(^|/)(\.git|\.work|node_modules|test|\.npmrc)(/|$)' }).Count -eq 0) 'ZIP excludes development data and local config'
    $client=$archive.GetEntry($prefix+'lib/client.js')
    Assert ($null -ne $client -and $null -ne $archive.GetEntry($prefix+'package.json') -and $null -ne $archive.GetEntry($prefix+'cordis.patch.yml')) 'ZIP exposes directly resolvable package entries'
    $stream=$client.Open()
    try { $hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose() }
    $sourceHash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes((Join-Path $root 'lib/client.js')))).Replace('-','')
    Assert ($hash -eq $sourceHash) 'ZIP client bytes match tested source'
  } finally { $archive.Dispose() }
  Write-Host "$passed ZIP tests passed."
} finally {
  $checkedOutput=[IO.Path]::GetFullPath($output)
  if ($checkedOutput -eq $distRoot -or -not $checkedOutput.StartsWith($distRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing unsafe test cleanup' }
  if (Test-Path -LiteralPath $checkedOutput) {
    foreach($item in @((Get-Item -LiteralPath $checkedOutput -Force)) + @(Get-ChildItem -LiteralPath $checkedOutput -Recurse -Force)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing test cleanup through a link' }
    }
    Remove-Item -LiteralPath $checkedOutput -Recurse -Force
  }
}
