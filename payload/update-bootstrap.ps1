param([string]$Target, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Get-UiText([string]$Value) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value)) }
try {
 if ([string]::IsNullOrWhiteSpace($Target)) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = Get-UiText '6K+36YCJ5oup5Y6f5p2l55qE6ZWc5bqP6L2v5Lu25paH5Lu25aS577yI5YyF5ZCr5ZCv5Yqo5bel5L2c5Y+wLmNtZO+8iQ=='
  try {
   if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
   $Target = $dialog.SelectedPath
  } finally { $dialog.Dispose() }
 }
 $Target = (Get-Item -LiteralPath $Target).FullName
 $node = Join-Path $Target 'runtime/node.exe'
 if (!(Test-Path -LiteralPath $node -PathType Leaf)) { throw (Get-UiText '5q2k5paH5Lu25aS557y65bCRIHJ1bnRpbWUvbm9kZS5leGXvvIzor7fpgInmi6nljp/mnaXnmoTlrozmlbTkvr/mkLrniYjnm67lvZXjgII=') }
 if ($VerifyOnly) { [Console]::Write($Target); exit 0 }
 & $node (Join-Path $PSScriptRoot 'update.mjs') --target $Target
 exit $LASTEXITCODE
} catch { Write-Host ((Get-UiText '5pu05paw5pyq5a6M5oiQ77ya') + $_.Exception.Message); exit 1 }
