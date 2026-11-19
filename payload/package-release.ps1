param([switch]$Full)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageRoot = $PSScriptRoot
$releaseRoot = Split-Path -Parent $packageRoot
$packageItems = @('public','tests','vendor','core.mjs','providers.mjs','server.mjs','download-proxy.mjs','subscriptions.mjs','builtin-proxy.mjs','core-runner.mjs','asset-library.mjs','video-stream.mjs','distribution-subscription.json','folders.mjs','choose-folder.ps1','launcher.mjs','package.json','package-release.ps1','update.mjs','online-update.mjs','online-install.mjs','update-bootstrap.ps1','release-baseline.json','更新软件.cmd','备份本机记录.cmd','恢复本机记录.cmd','启动工作台.cmd','start.command','start.sh','使用说明.md','官方API参考文档.md','THIRD-PARTY.md','.gitignore')
function Write-StudioArchive($outputName, $items) {
 $outputPath = Join-Path $releaseRoot $outputName
 $stream = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
 $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
 try {
  foreach ($item in $items) {
   $itemPath = Join-Path $packageRoot $item
   $files = if (Test-Path -LiteralPath $itemPath -PathType Container) { Get-ChildItem -LiteralPath $itemPath -Recurse -File } else { Get-Item -LiteralPath $itemPath }
   foreach ($file in $files) {
    $entryName = [IO.Path]::GetRelativePath($packageRoot, $file.FullName).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
   }
  }
 } finally { $archive.Dispose(); $stream.Dispose() }
 $check = [IO.Compression.ZipFile]::OpenRead($outputPath)
 try {
  $names = @($check.Entries.FullName)
  foreach($required in @('release-manifest.json','update.mjs','更新软件.cmd')){if($required -notin $names){throw "Missing $required"}}
  if($names | Where-Object {$_ -like 'data/*'}){throw 'Archive must not contain local user data'}
  [pscustomobject]@{Archive=$outputName;Files=$names.Count;Megabytes=[Math]::Round((Get-Item -LiteralPath $outputPath).Length/1MB,1);Verified=$true}
 } finally {$check.Dispose()}
}
$manifestFiles = foreach($item in ($packageItems + @('runtime'))){
 $itemPath=Join-Path $packageRoot $item
 $files=if(Test-Path -LiteralPath $itemPath -PathType Container){Get-ChildItem -LiteralPath $itemPath -Recurse -File}else{Get-Item -LiteralPath $itemPath}
 foreach($file in $files){@{path=[IO.Path]::GetRelativePath($packageRoot,$file.FullName).Replace('\','/');sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
}
$version=(Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw|ConvertFrom-Json).version
$baseline=Get-Content -LiteralPath (Join-Path $packageRoot 'release-baseline.json') -Raw|ConvertFrom-Json
$old=@{};foreach($entry in $baseline.files){$old[$entry.path]=$entry.sha256}
$changed=@($manifestFiles|Where-Object {$old[$_.path] -ne $_.sha256})
$helpers=@('update.mjs','folders.mjs','choose-folder.ps1','更新软件.cmd','update-bootstrap.ps1')
$patch=@($manifestFiles|Where-Object {$_.path -in $helpers -or $_.path -in $changed.path})
$requires=@($manifestFiles|Where-Object {($_.path -like 'runtime/*' -or $_.path -like 'vendor/*') -and $_.path -notin $patch.path})
@{format='jingxu-update-v1';version=$version;baseVersion=$baseline.version;files=@($patch);requires=@($requires)} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packageRoot 'release-manifest.json') -Encoding utf8
Write-StudioArchive '镜序-Huimiao-仅更新软件.zip' (@($patch.path)+@('release-manifest.json'))
if($Full){
 @{format='jingxu-update-v1';version=$version;files=@($manifestFiles)} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packageRoot 'release-manifest.json') -Encoding utf8
 $packageItems += 'release-manifest.json'
 Write-StudioArchive '镜序-Huimiao-Windows便携版.zip' ($packageItems + @('runtime'))
 Write-StudioArchive '镜序-Huimiao-跨平台源码.zip' ($packageItems + @('runtime/sing-box'))
}
