[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$RepoRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
$TestRoot=Join-Path $RepoRoot '.work\publish-tests'
$Work=Join-Path $TestRoot ([guid]::NewGuid().ToString('N'))
$Source=Join-Path (Split-Path -Parent $PSScriptRoot) 'publish-release.ps1'
$script:Passed=0
function Assert([bool]$ok,[string]$label){if(-not $ok){throw "FAIL: $label"};$script:Passed++;Write-Host "PASS: $label"}
function Write-Utf8([string]$p,[string]$s){[IO.File]::WriteAllText($p,$s,(New-Object Text.UTF8Encoding($true)))}
function Fixture([string]$name){
  $d=Join-Path $Work $name;$b=Join-Path $d 'bin';$r=Join-Path $d 'checkout';New-Item -ItemType Directory -Path $b,$r|Out-Null
  Copy-Item $Source (Join-Path $r 'publish-release.ps1')
  Write-Utf8 (Join-Path $r 'package.json') '{"name":"dsh-codex-ui","version":"1.2.0","repository":{"url":"git+https://github.com/chadqian2012-sudo/dsh-codex-ui.git"}}'
  Write-Utf8 (Join-Path $r 'CHANGELOG.md') '# 1.2.0'
  $git=@'
@echo off
echo git %* ^| %CD%>>"%MOCK_LOG%"
if /i "%3 %4"=="rev-parse HEAD" (echo abcdef& exit /b 0)
if /i "%3 %4 %5"=="branch --show-current " (echo main& exit /b 0)
if /i "%3 %4"=="status --porcelain" (if /i "%MOCK_DIRTY%"=="1" (echo ?? dirty.txt)& exit /b 0)
if /i "%3 %4 %5"=="remote get-url origin" (echo https://github.com/chadqian2012-sudo/dsh-codex-ui.git& exit /b 0)
if /i "%3"=="check-ref-format" exit /b 0
if /i "%3"=="ls-remote" (if /i "%MOCK_REMOTE_TAG%"=="1" (echo abcdef refs/tags/v1.2.0)& exit /b 0)
if /i "%3"=="show-ref" exit /b 1
if /i "%3"=="push" exit /b 0
exit /b 0
'@
  $gh=@'
@echo off
echo gh %* ^| %CD%>>"%MOCK_LOG%"
if /i "%1 %2"=="auth status" exit /b 0
if /i "%1 %2 %3"=="api user --jq" (echo chadqian2012-sudo& exit /b 0)
if /i "%1 %2 %3"=="api -i repos/chadqian2012-sudo/dsh-codex-ui" (if /i "%MOCK_REPO%"=="absent" (echo HTTP/2.0 404 Not Found 1>&2& exit /b 1) else (if /i "%MOCK_REPO%"=="error" (echo HTTP/2.0 500 Error 1>&2& exit /b 1) else (echo HTTP/2.0 200 OK& exit /b 0)))
if /i "%1 %2"=="api repos/chadqian2012-sudo/dsh-codex-ui" (if /i "%3"=="--jq" (echo chadqian2012-sudo/dsh-codex-ui public true) else (echo HTTP/2.0 404 Not Found 1>&2& exit /b 1)& exit /b 0)
if /i "%1 %2 %3"=="api -i repos/chadqian2012-sudo/dsh-codex-ui/releases/tags/v1.2.0" (echo HTTP/2.0 404 Not Found 1>&2& exit /b 1)
if /i "%1 %2"=="repo create" exit /b 0
if /i "%1 %2"=="release create" exit /b 0
exit /b 0
'@
  $npm=@'
@echo off
echo npm %* ^| %CD%>>"%MOCK_LOG%"
if /i "%1"=="pack" goto do_pack
if /i "%1"=="publish" goto do_publish
if /i "%1"=="whoami" (echo %MOCK_NPM_LOGIN%& exit /b 0)
if /i "%1"=="test" exit /b 0
if /i "%1 %2 %3"=="run test:distribution" exit /b 0
if /i "%1 %2 %3"=="view dsh-codex-ui maintainers" (if /i "%MOCK_PACKAGE%"=="absent" (echo npm error code E404 1>&2& exit /b 1) else (if /i "%MOCK_MAINTAINERS%"=="other" (echo [{"name":"chad_0314"},{"name":"other-user"}]& exit /b 0) else (echo [{"name":"chad_0314"}]& exit /b 0)))
if /i "%1 %2 %3"=="view dsh-codex-ui@1.2.0 version" (if /i "%MOCK_VERSION%"=="exists" (echo "1.2.0"& exit /b 0) else (echo npm error code E404 1>&2& exit /b 1))
exit /b 0
:do_pack
for %%D in (%4) do echo mock>"%%~D\dsh-codex-ui-1.2.0.tgz"
exit /b 0
:do_publish
echo npm 2FA prompt visible
if /i "%MOCK_PUBLISH_FAIL%"=="1" exit /b 1
exit /b 0
'@
  Write-Utf8 (Join-Path $r 'pack-dist.ps1') "param([string]`$OutDir); [IO.File]::WriteAllText((Join-Path `$OutDir 'dsh-codex-ui-1.2.0.zip'),'zip')"
  Write-Utf8 (Join-Path $b 'git.cmd') $git;Write-Utf8 (Join-Path $b 'gh.cmd') $gh;Write-Utf8 (Join-Path $b 'npm.cmd') $npm
  return [pscustomobject]@{Bin=$b;Root=$r;Log=(Join-Path $d 'calls.log');Dist=(Join-Path $r 'dist')}
}
function Run($f,[string]$scenario='success',[switch]$whatif){
  $names=@('PATH','MOCK_LOG','MOCK_DIST','MOCK_REPO','MOCK_REMOTE_TAG','MOCK_DIRTY','MOCK_PACKAGE','MOCK_MAINTAINERS','MOCK_VERSION','MOCK_PUBLISH_FAIL','MOCK_NPM_LOGIN');$old=@{}
  foreach($n in $names){$old[$n]=[Environment]::GetEnvironmentVariable($n)}
  try{
    $env:PATH=$f.Bin+';'+$old.PATH;$env:MOCK_LOG=$f.Log;$env:MOCK_DIST=$f.Dist;$env:MOCK_REPO='absent';$env:MOCK_REMOTE_TAG='0';$env:MOCK_DIRTY='0';$env:MOCK_PACKAGE='absent';$env:MOCK_MAINTAINERS='self';$env:MOCK_VERSION='absent';$env:MOCK_PUBLISH_FAIL='0';$env:MOCK_NPM_LOGIN='chad_0314'
    switch($scenario){repoerror{$env:MOCK_REPO='error'};dirty{$env:MOCK_DIRTY='1'};existing{$env:MOCK_REPO='exists'};tag{$env:MOCK_REPO='exists';$env:MOCK_REMOTE_TAG='1'};version{$env:MOCK_REPO='exists';$env:MOCK_PACKAGE='exists';$env:MOCK_VERSION='exists'};maintainer{$env:MOCK_REPO='exists';$env:MOCK_PACKAGE='exists';$env:MOCK_MAINTAINERS='other'};wrongnpm{$env:MOCK_NPM_LOGIN='wrong-account'};publishfail{$env:MOCK_PUBLISH_FAIL='1'}}
    $a=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $f.Root 'publish-release.ps1'));if($whatif){$a+= '-WhatIf'}
    $savedEap=$ErrorActionPreference;$ErrorActionPreference='Continue'
    $script:Output=& (Join-Path $PSHOME 'powershell.exe') @a 2>&1|Out-String;$script:Exit=$LASTEXITCODE
    $ErrorActionPreference=$savedEap
  }finally{foreach($n in $names){[Environment]::SetEnvironmentVariable($n,$old[$n])}}
}
function Calls($f){if(Test-Path $f.Log){return [IO.File]::ReadAllText($f.Log)};return ''}
try{
  New-Item -ItemType Directory -Path $Work -Force|Out-Null
  $f=Fixture 'whatif';Run $f 'success' -whatif
  Assert ($script:Exit -eq 0 -and $script:Output -match 'WhatIf') 'WhatIf describes without running commands'
  Assert (-not(Test-Path $f.Log) -and -not(Test-Path $f.Dist)) 'WhatIf creates no output directory or mock log'
  $f=Fixture 'success';Run $f;$c=Calls $f
  Assert ($script:Exit -eq 0 -and $script:Output -match '发布完成') 'first release works with command mocks'
  Assert ($c -notmatch 'ls-remote' -and $c -match 'repo create' -and $c -match 'push --dry-run' -and $c -match 'push origin') 'new repo skips remote tag lookup and dry-runs push'
  Assert ($c.IndexOf('npm test') -lt $c.IndexOf('repo create') -and $c.IndexOf('test:distribution') -lt $c.IndexOf('repo create')) 'tests precede external repository write'
  Assert ($c.IndexOf('repo create') -lt $c.IndexOf('push --dry-run') -and $c.IndexOf('push --dry-run') -lt $c.IndexOf('push origin') -and $c.IndexOf('push origin') -lt $c.IndexOf('release create') -and $c.IndexOf('release create') -lt $c.IndexOf('npm publish')) 'new repository writes follow create, dry-run, push, release, publish order'
  Assert (@(($c -split "`r?`n") | Where-Object { $_ -and $_ -notmatch ([regex]::Escape('| '+$f.Root)) }).Count -eq 0) 'all mocked external commands run with checkout as working directory'
  Assert ((Get-ChildItem $f.Dist -Directory -Filter 'publish-1.2.0-*').Count -eq 1) 'artifacts use unique versioned output directory'
  $f=Fixture 'existing';Run $f 'existing';$c=Calls $f
  Assert ($script:Exit -eq 0 -and $c -match 'ls-remote' -and $c -notmatch 'repo create') 'existing repository checks refs and is not recreated'
  $f=Fixture 'repoerror';Run $f 'repoerror';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $c -notmatch 'repo create') 'non-404 repo error does not create repository'
  $f=Fixture 'dirty';Run $f 'dirty';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $script:Output -match '工作树' -and $c -notmatch 'gh ') 'dirty checkout stops before external commands'
  $f=Fixture 'wrongnpm';Run $f 'wrongnpm';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $script:Output -match 'npm 账号不是 chad_0314' -and $c -notmatch 'npm test|repo create|push origin|release create|publish ') 'wrong npm account stops before tests and external writes'
  $f=Fixture 'tag';Run $f 'tag';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $script:Output -match '远端 tag' -and $c -notmatch 'repo create|push origin') 'existing remote tag stops publish'
  $f=Fixture 'version';Run $f 'version';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $script:Output -match 'npm dsh-codex-ui@1.2.0 已存在' -and $c -notmatch 'push origin|release create|publish ') 'existing npm version stops publish'
  $f=Fixture 'maintainer';Run $f 'maintainer';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $script:Output -match '其他维护者' -and $c -notmatch 'push origin|release create|publish ') 'other npm maintainer cannot be taken over'
  $f=Fixture 'publishfail';Run $f 'publishfail';$c=Calls $f
  Assert ($script:Exit -ne 0 -and $script:Output -match '2FA prompt visible' -and $script:Output -notmatch '发布完成') 'publish failure streams prompt without completion claim'
  Write-Host ([Environment]::NewLine+"$script:Passed publish tests passed.")
}finally{
  $repoFull=[IO.Path]::GetFullPath($RepoRoot).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $baseFull=[IO.Path]::GetFullPath($TestRoot).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $workFull=[IO.Path]::GetFullPath($Work).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  if ($baseFull -eq $repoFull -or -not $baseFull.StartsWith($repoFull+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Parent $workFull) -ne $baseFull -or (Split-Path -Leaf $workFull) -notmatch '^[0-9a-f]{32}$') { throw "Refusing unsafe publish test cleanup path: $workFull" }
  foreach($p in @($TestRoot,$Work)) { if(Test-Path -LiteralPath $p){$item=Get-Item -LiteralPath $p -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw "Refusing reparse publish test path: $p"}} }
  if(Test-Path -LiteralPath $Work){Remove-Item -LiteralPath $Work -Recurse -Force}
}
