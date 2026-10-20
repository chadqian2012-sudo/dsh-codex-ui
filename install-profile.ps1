<# Install or roll back this plugin in a DSH profile. Compatible with Windows PowerShell 5.1. #>
[CmdletBinding(SupportsShouldProcess=$false)]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string]$PluginDir = '',
  [switch]$Uninstall,
  [switch]$WhatIf,
  [string]$Rollback = ''
)
$ErrorActionPreference = 'Stop'
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:PluginName = 'dsh-codex-ui'
$script:LegacyPluginName = 'dsh-codex-effort-slider'
function Say([string]$s) { Write-Host "  $s" }
function Die([string]$s) { throw $s }
function Full([string]$p) { $f=[IO.Path]::GetFullPath($p); $r=[IO.Path]::GetPathRoot($f); if ($f.Length -gt $r.Length) { $f=$f.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) }; return $f }
function EntryExists([string]$p) { try { $null=[IO.File]::GetAttributes($p); return $true } catch { return (Test-Path -LiteralPath $p) } }
function IsUnder([string]$child,[string]$parent) {
  $c=Full $child; $p=Full $parent
  return $c.StartsWith($p + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-Under([string]$child,[string]$parent,[string]$label) {
  if (-not (IsUnder $child $parent)) { Die "$label 路径越界：$child" }
}
function Read-Json([string]$p) {
  try { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { Die "JSON 无效：$p`n$($_.Exception.Message)" }
}
function Write-Atomic([string]$path,[string]$content) {
  $tmp = $path + '.tmp-' + [guid]::NewGuid().ToString('N')
  $replaceBackup = $path + '.replace-backup-' + [guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp,$content,$script:Utf8)
  try { [IO.File]::Replace($tmp,$path,$replaceBackup) }
  finally {
    if (Test-Path -LiteralPath $tmp) { [IO.File]::Delete($tmp) }
    if (Test-Path -LiteralPath $replaceBackup) { [IO.File]::Delete($replaceBackup) }
  }
}
function Get-JunctionTarget([string]$path) {
  # DeviceIoControl reads the reparse-point itself, so PS 5.1 does not follow the junction.
  $src=@'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DshReparse {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string n,uint a,uint s,IntPtr sec,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h,uint code,IntPtr inb,uint ins,byte[] outb,uint outs,out uint ret,IntPtr ov);
 public static string Target(string path) {
  using(var h=CreateFile(path,0,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
   if(h.IsInvalid) throw new IOException("Cannot open reparse point",Marshal.GetExceptionForHR(Marshal.GetHRForLastWin32Error()));
   byte[] b=new byte[16384]; uint got; if(!DeviceIoControl(h,0x000900A8,IntPtr.Zero,0,b,(uint)b.Length,out got,IntPtr.Zero)) throw new IOException("Cannot read reparse point",Marshal.GetExceptionForHR(Marshal.GetHRForLastWin32Error()));
   uint tag=BitConverter.ToUInt32(b,0); if(tag!=0xA0000003 && tag!=0xA000000C) throw new IOException("Entry is not a junction/symlink");
   int pathBase=tag==0xA0000003?16:20; int start=BitConverter.ToUInt16(b,8); int len=BitConverter.ToUInt16(b,10); string t=System.Text.Encoding.Unicode.GetString(b,pathBase+start,len);
   if(t.StartsWith("\\??\\UNC\\",StringComparison.OrdinalIgnoreCase)) return "\\\\"+t.Substring(8);
   if(t.StartsWith("\\??\\")) return t.Substring(4); return t;
  }
 }
}
'@
  if (-not ('DshReparse' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }
  return [DshReparse]::Target($path)
}
function Remove-Entry([string]$path) {
  if (-not (EntryExists $path)) { return }
  $i=Get-Item -LiteralPath $path -Force
  if (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($path,$false) }
  elseif ($i.PSIsContainer) { Die "拒绝递归删除意外出现的目录：$path" }
  else { Remove-Item -LiteralPath $path -Force }
}
function Preserve-Or-RemoveGenerated([string]$path,[string]$backup,[string]$expectedTarget) {
  if (-not (EntryExists $path)) { return }
  $item=Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    try { if ((Full (Get-JunctionTarget $path)) -eq (Full $expectedTarget)) { Remove-Entry $path; return } } catch {}
  }
  if (EntryExists $backup) { $backup=$backup+'-'+[guid]::NewGuid().ToString('N') }
  Move-Entry $path $backup
}
function Make-Link([string]$path,[string]$target) {
  if ($env:OS -eq 'Windows_NT') { New-Item -ItemType Junction -Path $path -Target $target | Out-Null }
  else { New-Item -ItemType SymbolicLink -Path $path -Target $target | Out-Null }
}
function Move-Entry([string]$from,[string]$to) {
  if (-not (EntryExists $from)) { return }
  $item=Get-Item -LiteralPath $from -Force
  if ($item.PSIsContainer) { [IO.Directory]::Move($from,$to) } else { [IO.File]::Move($from,$to) }
}
function Atomic-Manifest([string]$path,[string]$json) { Write-Atomic $path $json }

try {
  if ($Uninstall -and $Rollback) { Die '不能同时指定 -Uninstall 与 -Rollback。' }
  if (-not $PluginDir) { $PluginDir=if($PSScriptRoot){$PSScriptRoot}else{Split-Path -Parent $MyInvocation.MyCommand.Path} }
  $PluginDir=Full $PluginDir; $DshHome=Full $DshHome
  if (-not (Test-Path -LiteralPath $DshHome -PathType Container)) { Die "找不到 DSH home：$DshHome" }
  if ([string]::IsNullOrWhiteSpace($Profile) -or $Profile -match '[\\/:]' -or $Profile -in @('.','..')) { Die 'Profile 必须是单一目录名。' }
  $profiles=Full (Join-Path $DshHome 'profiles'); $profileDir=Full (Join-Path $profiles $Profile)
  Assert-Under $profileDir $profiles 'profile'
  if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) { Die "找不到 profile：$profileDir" }
  foreach ($guardPath in @($profiles,$profileDir)) {
    if (Test-Path -LiteralPath $guardPath) { $guard=Get-Item -LiteralPath $guardPath -Force; if (($guard.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Die "拒绝通过链接路径修改 profile：$guardPath" } }
  }
  $manifestPath=Join-Path $profileDir 'package.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { Die "profile 缺少 package.json：$manifestPath" }
  $manifestItem=Get-Item -LiteralPath $manifestPath -Force; if (($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Die "拒绝修改被链接替代的 package.json：$manifestPath" }
  $modulesDir=Full (Join-Path $profileDir 'node_modules'); Assert-Under $modulesDir $profileDir 'node_modules'
  if (Test-Path -LiteralPath $modulesDir) {
    $mi=Get-Item -LiteralPath $modulesDir -Force
    if (($mi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Die "拒绝操作被链接替代的 node_modules：$modulesDir" }
  }
  $linkPath=Full (Join-Path $modulesDir $script:PluginName); Assert-Under $linkPath $modulesDir '包路径'
  if (-not $Uninstall -and -not $Rollback) {
    if (-not (Test-Path -LiteralPath $PluginDir -PathType Container)) { Die "插件目录不存在：$PluginDir" }
    $srcManifest=Join-Path $PluginDir 'package.json'; if (-not (Test-Path -LiteralPath $srcManifest -PathType Leaf)) { Die "插件缺少 package.json：$srcManifest" }
    $plugin=Read-Json $srcManifest
    if ($plugin.name -ne $script:PluginName -or -not $plugin.version -or -not $plugin.main -or -not $plugin.dsh.bundle.patch) { Die '插件 manifest 的 name/version/main/dsh.bundle.patch 缺失或不匹配。' }
    $entry=Full (Join-Path $PluginDir ([string]$plugin.main).Replace('/',[IO.Path]::DirectorySeparatorChar))
    Assert-Under $entry $PluginDir '包入口'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { Die "包入口不存在：$entry" }
    $patch=Full (Join-Path $PluginDir ([string]$plugin.dsh.bundle.patch).Replace('/',[IO.Path]::DirectorySeparatorChar))
    Assert-Under $patch $PluginDir 'bundle patch'; if (-not (Test-Path -LiteralPath $patch -PathType Leaf)) { Die "bundle patch 不存在：$patch" }
  }
  $manifest=Read-Json $manifestPath
  if (-not $Uninstall -and -not $Rollback) {
    $legacyRegistered = $manifest.dependencies.PSObject.Properties[$script:LegacyPluginName] -or @($manifest.dsh.profile.bundles) -contains $script:LegacyPluginName
    if ($legacyRegistered) { Die "profile 仍注册旧插件 $script:LegacyPluginName。请先在 DSH 原生管理页卸载旧插件，再安装 $script:PluginName；安装器不会自动删除旧插件或修改其注册。" }
  }
  if (-not $manifest.dependencies) { $manifest | Add-Member NoteProperty dependencies ([pscustomobject]@{}) }
  if (-not $manifest.dsh) { $manifest | Add-Member NoteProperty dsh ([pscustomobject]@{}) }
  if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member NoteProperty profile ([pscustomobject]@{}) }
  $depSpec='link:' + $PluginDir.Replace('\','/')
  $bundles=@($manifest.dsh.profile.bundles)
  if ($Uninstall) {
    if ($manifest.dependencies.PSObject.Properties[$script:PluginName]) { $manifest.dependencies.PSObject.Properties.Remove($script:PluginName) }
    $bundles=@($bundles | Where-Object { $_ -ne $script:PluginName })
  } elseif (-not $Rollback) {
    $manifest.dependencies | Add-Member NoteProperty $script:PluginName $depSpec -Force
    if ($bundles -notcontains $script:PluginName) { $bundles+= $script:PluginName }
  }
  $manifest.dsh.profile | Add-Member NoteProperty bundles $bundles -Force

  if ($Rollback) {
    $state=Full $Rollback; if (-not (Test-Path -LiteralPath $state -PathType Leaf)) { Die "回滚状态不存在：$state" }
    $stateObj=Read-Json $state; $stateDir=Split-Path -Parent $state
    $allowedBackupRoot=Full (Join-Path $profileDir '.dsh-plugin-backups'); Assert-Under $stateDir $allowedBackupRoot '回滚备份'
    if ($stateObj.profile -ne $Profile -or $stateObj.package -ne $script:PluginName) { Die '回滚状态不属于当前 profile/插件。' }
    if ($stateObj.manifestBackup -ne (Join-Path $stateDir 'package.json')) { Die '回滚状态引用无效。' }
    if (-not (Test-Path -LiteralPath $stateObj.manifestBackup -PathType Leaf)) { Die '原 manifest 备份缺失。' }
    $savedRaw=Get-Content -LiteralPath $stateObj.manifestBackup -Raw -Encoding UTF8
    $null=$savedRaw | ConvertFrom-Json
    $rollbackLink=Join-Path $stateDir 'previous-entry'
    if ($WhatIf) { Say "WhatIf: 将从 $state 恢复 manifest 与 node_modules 项"; exit 0 }
    $currentManifest=Join-Path $stateDir 'rollback-current-manifest.json'; Copy-Item -LiteralPath $manifestPath -Destination $currentManifest -Force
    $currentEntry=Join-Path $stateDir 'rollback-current-entry'
    try {
      if (Test-Path -LiteralPath $linkPath) { Move-Entry $linkPath $currentEntry }
      if ($stateObj.previousPresent) { Move-Entry $rollbackLink $linkPath }
      Atomic-Manifest $manifestPath $savedRaw
    } catch {
      if (EntryExists $linkPath) { Move-Entry $linkPath (Join-Path $stateDir 'rollback-failed-restoration') }
      if (Test-Path -LiteralPath $currentEntry) { Move-Entry $currentEntry $linkPath }
      Atomic-Manifest $manifestPath (Get-Content -LiteralPath $currentManifest -Raw -Encoding UTF8)
      throw
    }
    Say "已回滚。状态与当前版本保存在：$stateDir"; exit 0
  }

  $json=$manifest | ConvertTo-Json -Depth 40
  $null=$json | ConvertFrom-Json
  if ($WhatIf) { Say "WhatIf: profile=$Profile package=$script:PluginName mode=$(if($Uninstall){'卸载'}else{'安装'})"; exit 0 }
  if (-not (Test-Path -LiteralPath $modulesDir)) { New-Item -ItemType Directory -Path $modulesDir | Out-Null }
  $backupRoot=Full (Join-Path $profileDir '.dsh-plugin-backups'); Assert-Under $backupRoot $profileDir 'backup'
  if (Test-Path -LiteralPath $backupRoot) { $bi=Get-Item -LiteralPath $backupRoot -Force; if (($bi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Die "拒绝使用被链接替代的备份目录：$backupRoot" } }
  else { New-Item -ItemType Directory -Path $backupRoot | Out-Null }
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'; $stateDir=Join-Path $backupRoot ($script:PluginName+'-'+$stamp)
  New-Item -ItemType Directory -Path $stateDir | Out-Null
  $manifestBackup=Join-Path $stateDir 'package.json'; Copy-Item -LiteralPath $manifestPath -Destination $manifestBackup
  $previousPresent=EntryExists $linkPath
  $previousTarget=''; $previousReparse=$false
  if ($previousPresent) {
    $old=Get-Item -LiteralPath $linkPath -Force
    $previousReparse=(($old.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    if ($previousReparse) { $previousTarget=Get-JunctionTarget $linkPath }
  }
  $state=[ordered]@{ profile=$Profile; package=$script:PluginName; manifestBackup=$manifestBackup; previousPresent=$previousPresent; previousReparse=$previousReparse; previousTarget=$previousTarget; timestamp=$stamp }
  $statePath=Join-Path $stateDir 'state.json'; [IO.File]::WriteAllText($statePath,($state|ConvertTo-Json -Depth 8),$script:Utf8)
  $previousEntry=Join-Path $stateDir 'previous-entry'; $newEntry=Join-Path $modulesDir ($script:PluginName+'.new-'+$stamp)
  $movedOld=$false; $manifestWritten=$false
  try {
    if ($previousPresent) { Move-Entry $linkPath $previousEntry; $movedOld=$true }
    if (-not $Uninstall) { Make-Link $newEntry $PluginDir; Move-Entry $newEntry $linkPath }
    Atomic-Manifest $manifestPath $json; $manifestWritten=$true
    $check=Read-Json $manifestPath
    if ($Uninstall) {
      if ($check.dependencies.PSObject.Properties[$script:PluginName] -or @($check.dsh.profile.bundles) -contains $script:PluginName -or (EntryExists $linkPath)) { Die '卸载后校验失败。' }
    } else {
      $target=Full (Get-JunctionTarget $linkPath)
      $expected=Full $PluginDir
      $installed=Read-Json (Join-Path $linkPath 'package.json')
      $installedEntry=Full (Join-Path $linkPath ([string]$installed.main).Replace('/',[IO.Path]::DirectorySeparatorChar))
      $resolvedEntry=Full (Get-JunctionTarget $linkPath) # compare canonical link target separately below
      if ($target -ne $expected -or $installed.name -ne $script:PluginName -or $installed.version -ne $plugin.version -or -not (Test-Path -LiteralPath $installedEntry -PathType Leaf) -or $check.dependencies.$script:PluginName -ne ('link:' + $expected.Replace('\','/')) -or @($check.dsh.profile.bundles) -notcontains $script:PluginName) { Die '安装后 manifest、包入口、版本或 junction 目标校验失败。' }
    }
    Say "完成。可用 -Rollback `"$statePath`" 恢复本次变更。"
    if (-not $Uninstall) { Say "新版本 $($plugin.version) 已安装到 $linkPath。DSH 不会被自动重启；完全退出并重新启动后生效。" }
    else { Say '插件已卸载。DSH 不会被自动重启。' }
  } catch {
    Preserve-Or-RemoveGenerated $linkPath (Join-Path $stateDir 'failed-entry') $PluginDir
    Preserve-Or-RemoveGenerated $newEntry (Join-Path $stateDir 'failed-staged-entry') $PluginDir
    if ($movedOld -and (EntryExists $previousEntry)) { Move-Entry $previousEntry $linkPath }
    if (Test-Path -LiteralPath $manifestPath) {
      $originalRaw=Get-Content -LiteralPath $manifestBackup -Raw -Encoding UTF8
      $currentRaw=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
      if ($currentRaw -cne $originalRaw) { Atomic-Manifest $manifestPath $originalRaw }
    }
    throw "更新失败，已尝试恢复旧 manifest 和插件项。备份：$stateDir`n$($_.Exception.Message)"
  }
} catch { Write-Host "`n✗ $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
