$ErrorActionPreference = 'Stop'
$quantRoot = $PSScriptRoot
$quantNodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($quantNodeCommand) {
    $quantNodePath = $quantNodeCommand.Source
} else {
    throw '未找到 Node.js。请安装 Node.js 20 或更新版本，再运行此启动脚本。'
}

Push-Location -LiteralPath $quantRoot
try {
    & $quantNodePath 'server.mjs'
} finally {
    Pop-Location
}
