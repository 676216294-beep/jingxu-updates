$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.Windows.Forms
 $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
 $dialog.Description='请选择原来的镜序软件文件夹（包含启动工作台.cmd）'
 if($dialog.ShowDialog() -ne 'OK'){exit 0}
 $target=$dialog.SelectedPath
 $node=Join-Path $target 'runtime/node.exe'
 if(!(Test-Path -LiteralPath $node)){throw '此文件夹缺少 runtime/node.exe，请选择原来的完整便携版目录。'}
 & $node (Join-Path $PSScriptRoot 'update.mjs') --target $target
 exit $LASTEXITCODE
}catch{Write-Host ('更新未完成：'+$_.Exception.Message);exit 1}
