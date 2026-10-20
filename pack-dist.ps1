<# Create dist/<name>-<version>.zip. Paths are checked before recursive cleanup. #>
[CmdletBinding()]
param([string]$OutDir = '')
$ErrorActionPreference='Stop'
function Full([string]$p) { [IO.Path]::GetFullPath($p).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) }
function Under([string]$child,[string]$parent) { (Full $child).StartsWith((Full $parent)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) }
function Assert-SafeOutput([string]$p,[string]$out,[string]$label) {
  if (-not (Under $p $out)) { throw "$label 不在输出目录内：$p" }
  if ($p -match '(?i)(^|[\\/])\.(review|work)([\\/]|$)') { throw "$label 指向临时目录：$p" }
  if (Test-Path -LiteralPath $p) { $i=Get-Item -LiteralPath $p -Force; if (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "拒绝清理链接输出：$p" } }
}
function Assert-NoReparseAncestry([string]$p) {
  $walk=Full $p
  while ($walk) {
    if (Test-Path -LiteralPath $walk) { $entry=Get-Item -LiteralPath $walk -Force; if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "输出/源路径经过链接：$walk" } }
    $parent=Split-Path -Parent $walk
    if (-not $parent -or $parent -eq $walk) { break }; $walk=$parent
  }
}
$root=Full $(if($PSScriptRoot){$PSScriptRoot}else{Split-Path -Parent $MyInvocation.MyCommand.Path})
$manifestPath=Join-Path $root 'package.json'; if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 package.json：$manifestPath" }
$manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.name -or -not $manifest.version) { throw 'package.json 缺少 name/version。' }
if (-not $OutDir) { $OutDir=Join-Path $root 'dist' }
$out=Full $OutDir
if ($out -eq $root) { throw '输出目录不能是仓库根目录。' }
if ($out -match '(?i)(^|[\\/])\.(review|work)([\\/]|$)') { throw '输出目录不能是临时 .review/.work 目录。' }
$stage=Full (Join-Path $out $manifest.name); $zip=Full (Join-Path $out ($manifest.name+'-'+$manifest.version+'.zip'))
Assert-SafeOutput $stage $out 'staging'; Assert-SafeOutput $zip $out 'zip'
Assert-NoReparseAncestry $out
if (-not (Test-Path -LiteralPath $out)) { New-Item -ItemType Directory -Path $out | Out-Null }
if (Test-Path -LiteralPath $stage) {
  foreach($child in (Get-ChildItem -LiteralPath $stage -Recurse -Force)) {
    if (-not (Under $child.FullName $stage)) { throw "staging 包含越界条目：$($child.FullName)" }
    if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "拒绝递归清理含链接的 staging：$($child.FullName)" }
  }
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null
$include=@('package.json')+@($manifest.files)+@('LICENSE','install-profile.ps1','install.cmd','INSTALL.md')
$copied=@()
foreach($entry in ($include | Select-Object -Unique)) {
  if ([IO.Path]::IsPathRooted([string]$entry) -or ([string]$entry -split '[\\/]') -contains '..' -or ([string]$entry -match '(?i)(^|[\\/])\.(review|work)([\\/]|$)')) { throw "打包白名单包含不安全路径：$entry" }
  $source=Full (Join-Path $root ([string]$entry))
  if (-not (Under $source $root)) { throw "源文件越出仓库：$entry" }
  if (-not (Test-Path -LiteralPath $source)) { Write-Host "  跳过（不存在）：$entry" -ForegroundColor Yellow; continue }
  Assert-NoReparseAncestry $source
  $target=Join-Path $stage ([string]$entry); $parent=Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $item=Get-Item -LiteralPath $source -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "拒绝打包链接源：$source" }
  if ($item.PSIsContainer) {
    foreach($child in (Get-ChildItem -LiteralPath $source -Recurse -Force)) {
      if (-not (Under $child.FullName $source)) { throw "打包目录包含越界条目：$($child.FullName)" }
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "拒绝打包链接条目：$($child.FullName)" }
      if ($child.FullName -match '(?i)(^|[\\/])\.(review|work)([\\/]|$)') { throw "拒绝包含临时目录：$($child.FullName)" }
    }
  }
  if ($item.PSIsContainer) { Copy-Item -LiteralPath $source -Destination $target -Recurse -Force }
  else { Copy-Item -LiteralPath $source -Destination $target -Force }
  $copied+=$entry
}
Get-ChildItem -LiteralPath $stage -Recurse -File -Filter '*.ps1' | ForEach-Object {
  $content=[IO.File]::ReadAllText($_.FullName,(New-Object System.Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($_.FullName,$content,(New-Object System.Text.UTF8Encoding($true)))
}
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Host "`n打包完成：$zip" -ForegroundColor Green
Write-Host ("  {0} ({1:N0} KB)" -f (Split-Path -Leaf $zip),((Get-Item -LiteralPath $zip).Length/1KB))
Write-Host '  内容：'
Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object { Write-Host ("    {0,-44} {1,8:N0} B" -f $_.FullName.Substring($stage.Length+1),$_.Length) }
