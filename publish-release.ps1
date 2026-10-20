[CmdletBinding()]
param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Owner = 'chadqian2012-sudo'
$RepoName = 'dsh-codex-ui'
$PackageName = 'dsh-codex-ui'
$ExpectedOrigin = "https://github.com/$Owner/$RepoName.git"
$ExpectedSshOrigin = "git@github.com:$Owner/$RepoName.git"
$Registry = 'https://registry.npmjs.org/'
$Root = [IO.Path]::GetFullPath($PSScriptRoot)
$ManifestPath = Join-Path $Root 'package.json'

function Stop-Release([string]$Message) { throw $Message }

function Invoke-Captured([string]$Command, [string[]]$Arguments, [string]$Purpose) {
  $savedPreference = $ErrorActionPreference
  $output = @()
  $code = 1
  Push-Location -LiteralPath $Root
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $Command @Arguments 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
  } catch {
    $output += $_.Exception.Message
    $code = 1
  } finally {
    Pop-Location
    $ErrorActionPreference = $savedPreference
  }
  return [pscustomobject]@{ ExitCode = $code; Output = ($output -join "`n"); Purpose = $Purpose }
}

function Invoke-Streaming([string]$Command, [string[]]$Arguments, [string]$Purpose) {
  $savedPreference = $ErrorActionPreference
  Push-Location -LiteralPath $Root
  try {
    $ErrorActionPreference = 'Continue'
    & $Command @Arguments
    $script:StreamingExitCode = $LASTEXITCODE
  } catch {
    Write-Error "$Purpose 运行失败。"
    $script:StreamingExitCode = 1
  } finally {
    Pop-Location
    $ErrorActionPreference = $savedPreference
  }
}

function Require-Success($Result) {
  if ($Result.ExitCode -ne 0) { Stop-Release "$($Result.Purpose) 失败（退出码 $($Result.ExitCode)）；已停止，未尝试把错误当作资源不存在。" }
  return $Result.Output
}

function Is-NotFound($Result) {
  return $Result.Output -match '(?im)(HTTP/[0-9.]+\s+404|\bE404\b|\b404 Not Found\b|release not found)'
}

function Assert-NoExistingPath([string]$Path, [string]$Label) {
  if (Test-Path -LiteralPath $Path) { Stop-Release "$Label 已存在：$Path。为保护已有产物，拒绝覆盖。" }
}

if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { Stop-Release "缺少 package.json：$ManifestPath" }
try { $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
catch { Stop-Release 'package.json 无法解析。' }
if ($Manifest.name -cne $PackageName -or $Manifest.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  Stop-Release "package.json 必须是 $PackageName 且包含有效版本号。"
}
if (-not $Manifest.repository.url -or $Manifest.repository.url -notmatch "github\.com[:/]$Owner/$RepoName(?:\.git)?$") {
  Stop-Release "package.json repository 必须指向 $Owner/$RepoName。"
}
$Version = [string]$Manifest.version
$Tag = "v$Version"
$ChangelogPath = Join-Path $Root 'CHANGELOG.md'

if ($WhatIf) {
  Write-Host "发布目标：GitHub $Owner/$RepoName（public），npm $PackageName@$Version，tag $Tag"
  Write-Host '步骤：校验账号与干净 main → 检查仓库/tag/release/npm 所有权 → 生成 tgz/zip/SHA256SUMS → 推送 main 与 tag → 创建 GitHub Release → npm publish。'
  Write-Host 'WhatIf：未访问外部服务、未写入文件或 GitHub/npm。'
  exit 0
}

if (-not (Test-Path -LiteralPath $ChangelogPath -PathType Leaf)) { Stop-Release '缺少 CHANGELOG.md，不能生成发布说明。' }
$HeadBeforeTests = (Require-Success (Invoke-Captured 'git' @('-C', $Root, 'rev-parse', 'HEAD') '记录发布提交')).Trim()
$Branch = Require-Success (Invoke-Captured 'git' @('-C', $Root, 'branch', '--show-current') '读取当前分支')
if ($Branch.Trim() -cne 'main') { Stop-Release '发布必须从 main 分支运行。' }
$Status = Require-Success (Invoke-Captured 'git' @('-C', $Root, 'status', '--porcelain') '检查工作树')
if (-not [string]::IsNullOrWhiteSpace($Status)) { Stop-Release '工作树有未提交或未跟踪改动；请先提交或清理后再发布。' }
$Origin = Require-Success (Invoke-Captured 'git' @('-C', $Root, 'remote', 'get-url', 'origin') '读取 origin')
if ($Origin.Trim() -cnotin @($ExpectedOrigin, $ExpectedSshOrigin)) { Stop-Release "origin URL 不匹配目标仓库；预期 $ExpectedOrigin 或 $ExpectedSshOrigin。" }
$null = Require-Success (Invoke-Captured 'git' @('-C', $Root, 'check-ref-format', "refs/tags/$Tag") '校验发布 tag')
$null = Require-Success (Invoke-Captured 'gh' @('auth', 'status', '--hostname', 'github.com') '检查 GitHub 登录')
$GhLogin = (Require-Success (Invoke-Captured 'gh' @('api', 'user', '--jq', '.login') '读取 GitHub 账号')).Trim()
if ($GhLogin -cne $Owner) { Stop-Release "当前 GitHub 账号不是 $Owner；已停止。" }
$NpmLogin = (Require-Success (Invoke-Captured 'npm' @('whoami', '--registry', $Registry) '检查 npm 登录')).Trim()
if ([string]::IsNullOrWhiteSpace($NpmLogin)) { Stop-Release 'npm whoami 未返回账号；已停止。' }
$null = Require-Success (Invoke-Captured 'npm' @('test') '运行 npm test')
$null = Require-Success (Invoke-Captured 'npm' @('run', 'test:distribution') '运行 distribution tests')
$HeadAfterTests = (Require-Success (Invoke-Captured 'git' @('-C', $Root, 'rev-parse', 'HEAD') '复核发布提交')).Trim()
$StatusAfterTests = Require-Success (Invoke-Captured 'git' @('-C', $Root, 'status', '--porcelain') '复核测试后的工作树')
if ($HeadAfterTests -cne $HeadBeforeTests -or -not [string]::IsNullOrWhiteSpace($StatusAfterTests)) {
  Stop-Release '测试期间提交或工作树发生变化；未进行外部写入。'
}

# 查询仓库并区分明确的 404 与权限、网络或认证故障。
$RepoQuery = Invoke-Captured 'gh' @('api', '-i', "repos/$Owner/$RepoName") '查询 GitHub 仓库'
$RepoExists = $RepoQuery.ExitCode -eq 0
if (-not $RepoExists -and -not (Is-NotFound $RepoQuery)) { Stop-Release '查询 GitHub 仓库失败（非 404）；检查网络、gh 登录和权限后重试。' }
if ($RepoExists) {
  $RepoInfo = Require-Success (Invoke-Captured 'gh' @('api', "repos/$Owner/$RepoName", '--jq', '[.full_name,.visibility,(.permissions.push // false)] | @tsv') '核对 GitHub 仓库身份与权限')
  $RepoFields = $RepoInfo.Trim() -split '\s+'
  if ($RepoFields.Count -lt 3 -or $RepoFields[0] -cne "$Owner/$RepoName" -or $RepoFields[1] -cne 'public' -or $RepoFields[2] -cne 'true') {
    Stop-Release '现有 GitHub 仓库身份、公开状态或 push 权限不符合要求；不接管、不更改。'
  }
  $ReleaseQuery = Invoke-Captured 'gh' @('api', '-i', "repos/$Owner/$RepoName/releases/tags/$Tag") '检查现有 GitHub Release'
  if ($ReleaseQuery.ExitCode -eq 0) { Stop-Release "GitHub Release $Tag 已存在；拒绝覆盖。" }
  if (-not (Is-NotFound $ReleaseQuery)) { Stop-Release '查询 GitHub Release 失败（非 404）；已停止。' }
}

# Existing repositories are queried for tags. A new, confirmed-404 repository has no remote refs yet.
if ($RepoExists) {
  $RemoteTags = Invoke-Captured 'git' @('-C', $Root, 'ls-remote', '--tags', 'origin', "refs/tags/$Tag", "refs/tags/$Tag^{}") '检查远端 tag'
  $RemoteTagText = Require-Success $RemoteTags
  if (-not [string]::IsNullOrWhiteSpace($RemoteTagText)) { Stop-Release "远端 tag $Tag 已存在；拒绝覆盖。" }
}
$LocalTag = Invoke-Captured 'git' @('-C', $Root, 'show-ref', '--verify', '--quiet', "refs/tags/$Tag") '检查本地 tag'
if ($LocalTag.ExitCode -eq 0) { Stop-Release "本地 tag $Tag 已存在；拒绝覆盖。" }
if ($LocalTag.ExitCode -ne 1) { Stop-Release '检查本地 tag 失败；已停止。' }

# 查询 npm 包存在性与维护者；只有明确的 E404 才能作为“尚不存在”处理。
$PackageQuery = Invoke-Captured 'npm' @('view', $PackageName, 'maintainers', '--json', '--registry', $Registry) '查询 npm 包维护者'
$PackageExists = $PackageQuery.ExitCode -eq 0
if (-not $PackageExists -and -not (Is-NotFound $PackageQuery)) { Stop-Release '查询 npm 包失败（非 E404）；检查网络、npm 登录和权限后重试。' }
if ($PackageExists) {
  try { $Maintainers = @($PackageQuery.Output | ConvertFrom-Json) }
  catch { Stop-Release 'npm 已返回包信息但维护者列表无法解析；拒绝接管。' }
  $MaintainerNames = @($Maintainers | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.name } } | Where-Object { $_ })
  if ($MaintainerNames.Count -eq 0 -or @($MaintainerNames | Where-Object { $_ -cne $NpmLogin }).Count -gt 0 -or @($MaintainerNames | Where-Object { $_ -ceq $NpmLogin }).Count -eq 0) {
    Stop-Release 'npm 包已有其他维护者或无法确认当前账号维护权限；拒绝接管。'
  }
  $VersionQuery = Invoke-Captured 'npm' @('view', "$PackageName@$Version", 'version', '--json', '--registry', $Registry) '检查 npm 版本'
  if ($VersionQuery.ExitCode -eq 0) { Stop-Release "npm $PackageName@$Version 已存在；请先核查发布历史，拒绝覆盖。" }
  if (-not (Is-NotFound $VersionQuery)) { Stop-Release '查询 npm 版本失败（非 E404）；已停止。' }
}

$DistRoot = Join-Path $Root 'dist'
if (Test-Path -LiteralPath $DistRoot) {
  $DistItem = Get-Item -LiteralPath $DistRoot -Force
  if (($DistItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Release 'dist 是链接路径，拒绝写入。' }
} else { New-Item -ItemType Directory -Path $DistRoot | Out-Null }
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$RunId = [guid]::NewGuid().ToString('N')
$DistDir = Join-Path $DistRoot "publish-$Version-$Stamp-$RunId"
if (Test-Path -LiteralPath $DistDir) { Stop-Release '独立发布输出目录意外已存在；拒绝覆盖。' }
New-Item -ItemType Directory -Path $DistDir | Out-Null
$ZipPath = Join-Path $DistDir "$PackageName-$Version.zip"
$TarballPath = Join-Path $DistDir "$PackageName-$Version.tgz"
$SumsPath = Join-Path $DistDir 'SHA256SUMS'

# 先生成并核对全部本地产物，再进行 GitHub/npm 写入。
$PackZip = Invoke-Captured 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'pack-dist.ps1'), '-OutDir', $DistDir) '生成 ZIP'
$null = Require-Success $PackZip
if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { Stop-Release '打包脚本没有生成预期 ZIP。' }
$PackNpm = Invoke-Captured 'npm' @('pack', '--json', '--pack-destination', $DistDir, '--ignore-scripts') '生成 npm tarball'
$PackNpmText = Require-Success $PackNpm
if (-not (Test-Path -LiteralPath $TarballPath -PathType Leaf)) { Stop-Release 'npm pack 没有生成预期 tarball。' }
$SumLines = @()
foreach ($Artifact in @($TarballPath, $ZipPath)) {
  $Hash = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash.ToLowerInvariant()
  $SumLines += "$Hash  $(Split-Path -Leaf $Artifact)"
}
[IO.File]::WriteAllLines($SumsPath, $SumLines, (New-Object System.Text.UTF8Encoding($false)))

if (-not $RepoExists) {
  $CreateRepo = Invoke-Captured 'gh' @('repo', 'create', "$Owner/$RepoName", '--public') '创建 GitHub 公开仓库'
  $null = Require-Success $CreateRepo
}

# Dry-run 验证写权限和 fast-forward 条件；实际 push 不带 force。
$PushProbe = Require-Success (Invoke-Captured 'git' @('-C', $Root, 'push', '--dry-run', 'origin', 'HEAD:refs/heads/main', "HEAD:refs/tags/$Tag") '验证 GitHub push 权限')
$Push = Invoke-Captured 'git' @('-C', $Root, 'push', 'origin', 'HEAD:refs/heads/main', "HEAD:refs/tags/$Tag") '推送 main 与发布 tag'
$null = Require-Success $Push

$Release = Invoke-Captured 'gh' @('release', 'create', $Tag, $TarballPath, $ZipPath, $SumsPath, '--repo', "$Owner/$RepoName", '--title', "$PackageName $Version", '--notes-file', $ChangelogPath) '创建 GitHub Release'
$null = Require-Success $Release

# npm publish may request interactive 2FA confirmation. Do not supply or capture an OTP.
Invoke-Streaming 'npm' @('publish', $TarballPath, '--access', 'public', '--registry', $Registry) '发布 npm 包'
if ($script:StreamingExitCode -ne 0) { Stop-Release "npm publish 失败（退出码 $script:StreamingExitCode）；GitHub Release 已创建，npm 发布未确认完成。" }
Write-Host "发布完成：GitHub https://github.com/$Owner/$RepoName/releases/tag/$Tag；npm $PackageName@$Version"
Write-Host "校验和：$SumsPath"
