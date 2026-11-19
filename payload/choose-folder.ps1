Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
$folderDialog.Description = 'Choose a folder for generated videos'
$folderDialog.ShowNewFolderButton = $true
$dialogOwner = New-Object System.Windows.Forms.Form
$dialogOwner.TopMost = $true
$dialogOwner.ShowInTaskbar = $false
try {
    if ($folderDialog.ShowDialog($dialogOwner) -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Write($folderDialog.SelectedPath)
    }
} finally {
    $folderDialog.Dispose()
    $dialogOwner.Dispose()
}
