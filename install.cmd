@PowerShell -ExecutionPolicy Bypass -NoProfile -Command Invoke-Expression $('$args=@(^&{$args} %*);'+[String]::Join(';',(Get-Content '%~f0') -notmatch '^^@PowerShell.*EOF$')) & goto :EOF

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ErrorActionPreference = "Stop"
$repo = "neoclide/coc.nvim"
$file = "coc.zip"

$releases = "https://api.github.com/repos/$repo/releases"

if ($args[0]) {
  $tag = $args[0]
} else {
  Write-Host Determining latest release
  $tag = (Invoke-WebRequest $releases | ConvertFrom-Json)[0].tag_name
}

$download = "https://github.com/$repo/releases/download/$tag/$file"
$url = "https://raw.githubusercontent.com/neoclide/coc.nvim/release/build/index.js"
$zip = "coc.zip"
$dir = "build"

new-item -Name $dir -ItemType directory -Force
if ($tag -eq "nightly") {
  Write-Host Dowloading nightly release
  Invoke-WebRequest $url -Out $dir\index.js
} else {
  Write-Host Dowloading $tag
  Invoke-WebRequest $download -Out $zip

  Write-Host Extracting release files
  Microsoft.PowerShell.Archive\Expand-Archive $zip -DestinationPath $dir -Force

  Remove-Item $zip -Force
  Write-Host install completed.
}
