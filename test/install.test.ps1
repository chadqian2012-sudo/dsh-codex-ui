[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$sandbox=Join-Path $root ('.work\install-test-'+[guid]::NewGuid().ToString('N'))
$scriptPath=Join-Path $root 'install-profile.ps1'
$passed=0
function Assert([bool]$condition,[string]$message) { if (-not $condition) { throw "FAIL: $message" }; $script:passed++; Write-Host "PASS: $message" -ForegroundColor Green }
function Read-Json([string]$path) { Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Full([string]$path) { $p=[IO.Path]::GetFullPath($path);$r=[IO.Path]::GetPathRoot($p);if($p.Length -gt $r.Length){$p=$p.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)};return $p }
function EntryExists([string]$path) { try { $null=[IO.File]::GetAttributes($path);return $true } catch { return $false } }
function New-TestJunction([string]$path,[string]$target) { New-Item -ItemType Junction -Path $path -Target $target | Out-Null }
function Get-TestJunctionTarget([string]$path) { return (Full (Get-JunctionTarget $path)) }
function Remove-SafeTree([string]$path) {
  if (-not (EntryExists $path)) { return }
  $item=Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    if (($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { [IO.Directory]::Delete($path,$false) }
    else { [IO.File]::Delete($path) }
    return
  }
  if (($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) {
    foreach($child in (Get-ChildItem -LiteralPath $path -Force)) { Remove-SafeTree $child.FullName }
    [IO.Directory]::Delete($path,$false)
  } else { [IO.File]::Delete($path) }
}
function New-Profile([string]$name) {
  $d=Join-Path $sandbox ("dsh\profiles\"+$name); New-Item -ItemType Directory -Path $d -Force | Out-Null
  $initial='{"name":"fixture","dependencies":{"keep-me":"^7.0.0"},"dsh":{"profile":{"bundles":["existing"]},"other":{"preserve":true}}}'
  [IO.File]::WriteAllText((Join-Path $d 'package.json'),$initial,(New-Object System.Text.UTF8Encoding($false)))
  return $d
}
function Run-Installer([string]$profile,[string[]]$extra=@()) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -DshHome (Join-Path $sandbox 'dsh') -Profile $profile @extra
  if ($LASTEXITCODE -ne 0) { throw "Installer failed ($LASTEXITCODE), args: $($extra -join ' ')" }
}
function Run-InstallerExpectFailure([string]$profile,[string[]]$extra=@()) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -DshHome (Join-Path $sandbox 'dsh') -Profile $profile @extra
  if ($LASTEXITCODE -eq 0) { throw "Installer unexpectedly succeeded, args: $($extra -join ' ')" }
}
try {
  New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
  $fixture=Read-Json (Join-Path $root 'package.json')
  $installerAst=$null;$parseErrors=$null
  $parsed=[System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$installerAst,[ref]$parseErrors)
  if ($parseErrors) { throw "Installer parser failed: $($parseErrors[0].Message)" }
  $targetFunction=$parsed.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-JunctionTarget'},$true)
  if (-not $targetFunction) { throw 'Get-JunctionTarget function is missing from installer.' }
  Invoke-Expression $targetFunction.Extent.Text
  $profile=New-Profile 'desktop'
  $manifest=Join-Path $profile 'package.json'
  $before=[IO.File]::ReadAllText($manifest)
  Run-Installer 'desktop' @('-WhatIf')
  Assert -condition (([IO.File]::ReadAllText($manifest) -ceq $before) -and -not (Test-Path (Join-Path $profile 'node_modules'))) -message 'WhatIf leaves profile untouched'

  # A normal install must stop before any writes when the old package is still registered.
  $legacy=New-Profile 'legacy-registered'
  $legacyManifest=Join-Path $legacy 'package.json'
  $legacyRaw='{"name":"fixture","dependencies":{"keep-me":"^7.0.0","dsh-codex-effort-slider":"link:C:/legacy/plugin"},"dsh":{"profile":{"bundles":["existing","dsh-codex-effort-slider"]},"other":{"preserve":true}}}'
  [IO.File]::WriteAllText($legacyManifest,$legacyRaw,(New-Object System.Text.UTF8Encoding($false)))
  $legacyModules=Join-Path $legacy 'node_modules'; New-Item -ItemType Directory -Path $legacyModules | Out-Null
  $legacyDir=Join-Path $legacyModules 'dsh-codex-effort-slider'; New-Item -ItemType Directory -Path $legacyDir | Out-Null
  $legacyMarker=Join-Path $legacyDir 'local-marker.txt'; [IO.File]::WriteAllText($legacyMarker,'keep',(New-Object System.Text.UTF8Encoding($false)))
  $legacyBefore=[IO.File]::ReadAllBytes($legacyManifest)
  Run-InstallerExpectFailure 'legacy-registered'
  Assert -condition ([Convert]::ToBase64String($legacyBefore) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyManifest))) -message 'Legacy registration refusal leaves manifest bytes unchanged'
  Assert -condition (([IO.File]::ReadAllText($legacyMarker) -ceq 'keep') -and -not (Test-Path (Join-Path $legacyModules 'dsh-codex-ui')) -and -not (Test-Path (Join-Path $legacy '.dsh-plugin-backups'))) -message 'Legacy registration refusal leaves package directories untouched'

  $probe=Join-Path $sandbox 'junction-probe'; $probeTarget=Join-Path $sandbox 'junction-target'; New-Item -ItemType Directory -Path $probeTarget | Out-Null
  try { New-TestJunction $probe $probeTarget } catch { Write-Warning 'Junction operations are blocked by this execution sandbox; only the WhatIf check could run.'; exit 2 }
  [IO.Directory]::Delete($probe,$false)

  # First install has no previous package entry; rollback must restore the manifest and remove its link.
  $first=New-Profile 'first-install';$firstManifest=Join-Path $first 'package.json';$firstOriginal=[IO.File]::ReadAllText($firstManifest)
  Run-Installer 'first-install'
  $firstLink=Join-Path (Join-Path $first 'node_modules') $fixture.name
  Assert -condition ((Get-TestJunctionTarget $firstLink) -eq (Full $root)) -message 'First install creates a junction to the package root'
  $firstState=Get-ChildItem (Join-Path $first '.dsh-plugin-backups') -Filter state.json -Recurse | Select-Object -First 1
  Assert -condition (-not (Read-Json $firstState.FullName).previousPresent) -message 'First install records that no prior package existed'
  Run-Installer 'first-install' @('-Rollback',$firstState.FullName)
  Assert -condition (-not (EntryExists $firstLink) -and [IO.File]::ReadAllText($firstManifest) -ceq $firstOriginal) -message 'First-install rollback removes the new link and restores the manifest'

  $modules=Join-Path $profile 'node_modules'; New-Item -ItemType Directory -Path $modules | Out-Null
  $entity=Join-Path $modules $fixture.name; New-Item -ItemType Directory -Path $entity | Out-Null
  [IO.File]::WriteAllText((Join-Path $entity 'local-marker.txt'),'keep',(New-Object System.Text.UTF8Encoding($false)))
  Run-Installer 'desktop'
  $link=Join-Path (Join-Path $profile 'node_modules') $fixture.name
  $entry=Join-Path $link $fixture.main
  Assert -condition ((Get-TestJunctionTarget $link) -eq (Full $root) -and (Test-Path $entry)) -message 'Existing entity directory is upgraded to the exact package junction'
  $state=Get-ChildItem (Join-Path $profile '.dsh-plugin-backups') -Filter state.json -Recurse | Sort-Object FullName | Select-Object -Last 1
  Assert -condition (Test-Path (Join-Path (Split-Path $state.FullName) 'previous-entry\local-marker.txt')) -message 'Prior entity directory is preserved in backup'
  $after=Read-Json $manifest
  Assert -condition ($after.dependencies.'keep-me' -eq '^7.0.0' -and $after.dsh.other.preserve -eq $true -and @($after.dsh.profile.bundles) -contains 'existing') -message 'Unrelated profile values survive install'
  Run-Installer 'desktop' @('-Rollback',$state.FullName)
  Assert -condition (((Get-Item -LiteralPath $link -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and (Test-Path (Join-Path $link 'local-marker.txt')) -and [IO.File]::ReadAllText($manifest) -ceq $before) -message 'Rollback restores the original entity directory and manifest'
  Run-Installer 'desktop'
  Run-Installer 'desktop'
  Assert -condition ((Get-ChildItem (Join-Path $profile '.dsh-plugin-backups') -Filter state.json -Recurse).Count -ge 2) -message 'Repeated install succeeds and records another rollback point'

  Run-Installer 'desktop' @('-Uninstall')
  $un=Read-Json $manifest
  Assert -condition (-not $un.dependencies.PSObject.Properties[$fixture.name] -and @($un.dsh.profile.bundles) -notcontains $fixture.name -and -not (Test-Path (Join-Path (Join-Path $profile 'node_modules') $fixture.name))) -message 'Uninstall removes package registration and link'

  # Correct and incorrect pre-existing junctions both get replaced and their exact previous target is retained.
  $foreign=Join-Path $sandbox 'foreign'; New-Item -ItemType Directory -Path $foreign | Out-Null
  foreach ($case in @(@('right',$root),@('wrong',$foreign))) {
    $p=New-Profile $case[0]; $nm=Join-Path $p 'node_modules'; New-Item -ItemType Directory -Path $nm | Out-Null
    New-TestJunction (Join-Path $nm $fixture.name) $case[1]
    Run-Installer $case[0]
    $actual=Get-TestJunctionTarget (Join-Path $nm $fixture.name)
    Assert -condition ($actual -eq (Full $root)) -message "$($case[0]) junction is repaired"
    $state=Get-ChildItem (Join-Path $p '.dsh-plugin-backups') -Filter state.json -Recurse | Select-Object -First 1
    $previous=Get-TestJunctionTarget (Join-Path (Split-Path $state.FullName) 'previous-entry')
    Assert -condition ($previous -eq (Full $case[1])) -message "$($case[0]) previous junction target is preserved"
    Run-Installer $case[0] @('-Rollback',$state.FullName)
    $restored=Get-TestJunctionTarget (Join-Path $nm $fixture.name)
    Assert -condition ($restored -eq (Full $case[1])) -message "$($case[0]) junction rollback restores its previous target"
  }

  # Hold the profile manifest without delete sharing so File.Replace fails after the old entry moves.
  $fault=New-Profile 'fault'; $fnm=Join-Path $fault 'node_modules'; New-Item -ItemType Directory -Path $fnm | Out-Null
  New-TestJunction (Join-Path $fnm $fixture.name) $foreign
  $fmanifest=Join-Path $fault 'package.json'; $original=[IO.File]::ReadAllText($fmanifest)
  $manifestLock=New-Object IO.FileStream($fmanifest,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -DshHome (Join-Path $sandbox 'dsh') -Profile fault; $failed=$LASTEXITCODE -ne 0 }
  finally { $manifestLock.Dispose() }
  $restored=Get-TestJunctionTarget (Join-Path $fnm $fixture.name)
  Assert -condition ($failed -and $restored -eq (Full $foreign) -and [IO.File]::ReadAllText($fmanifest) -ceq $original) -message 'Failure during commit restores old junction and manifest'

  # First-install commit failure must remove its new link and leave the original manifest intact.
  $firstFault=New-Profile 'first-install-fault';$ffmodules=Join-Path $firstFault 'node_modules';New-Item -ItemType Directory -Path $ffmodules|Out-Null
  $ffmanifest=Join-Path $firstFault 'package.json';$fforiginal=[IO.File]::ReadAllText($ffmanifest)
  $firstLock=New-Object IO.FileStream($ffmanifest,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -DshHome (Join-Path $sandbox 'dsh') -Profile 'first-install-fault'; $firstFailed=$LASTEXITCODE -ne 0 }
  finally { $firstLock.Dispose() }
  $fflink=Join-Path $ffmodules $fixture.name
  Assert -condition ($firstFailed -and -not (EntryExists $fflink) -and [IO.File]::ReadAllText($ffmanifest) -ceq $fforiginal) -message 'Failed first install leaves no package link and restores the manifest'
  Write-Host "`n$passed installer tests passed." -ForegroundColor Cyan
} catch {
  if ($_.Exception.Message -match '拒绝访问|Access is denied|privilege|权限') {
    Write-Warning "Junction testing is unavailable in this sandbox. The suite needs permission to create Windows junctions; setup and WhatIf checks ran before the restriction."
    exit 2
  }
  Write-Error $_; exit 1
} finally {
  $workspace=Full $root;$workRoot=Full (Join-Path $workspace '.work');$sandboxFull=Full $sandbox
  if ((Split-Path -Parent $sandboxFull) -ne $workRoot -or (Split-Path -Leaf $sandboxFull) -notmatch '^install-test-[0-9a-f]{32}$' -or -not ($sandboxFull.StartsWith($workspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))) { throw "Refusing unsafe test cleanup path: $sandboxFull" }
  if (EntryExists $sandboxFull) {
    $rootItem=Get-Item -LiteralPath $sandboxFull -Force
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing reparse test root: $sandboxFull" }
    Remove-SafeTree $sandboxFull
  }
}
