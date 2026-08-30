[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$ApiPort = 8000,
  [ValidateRange(1, 65535)]
  [int]$WebPort = 5173
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path ([System.IO.Path]::GetTempPath()) "jiaxiu-mvp"
$apiProcess = $null
$webProcess = $null

function Resolve-Executable([string]$Name) {
  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $command) {
    throw "未找到 $Name。请安装后重新运行。"
  }
  return $command.Source
}

function Get-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return $null }
  $match = Select-String -Path $Path -Pattern "^\s*$([regex]::Escape($Name))\s*=\s*(.*?)\s*$" | Select-Object -First 1
  if ($null -eq $match) { return $null }
  return $match.Matches[0].Groups[1].Value
}

# 本地启动时不会走 docker 的入口脚本，初始账号需在此创建。
# ensure-user 是幂等的：账号已存在时保持原密码，不会覆盖你自己改过的密码。
function Ensure-InitialUser([string]$Uv, [string]$WorkDir, [string]$RootDir, [string]$Role) {
  $usernameKey = "JIAXIU_${Role}_USERNAME".ToUpperInvariant()
  $passwordKey = "JIAXIU_${Role}_INITIAL_PASSWORD".ToUpperInvariant()
  $userName = Get-EnvValue (Join-Path $RootDir ".env") $usernameKey
  $password = Get-EnvValue (Join-Path $RootDir ".env") $passwordKey
  if ([string]::IsNullOrWhiteSpace($userName) -or [string]::IsNullOrWhiteSpace($password)) {
    Write-Warning "跳过 $Role 账号初始化：.env 中未配置 $usernameKey / $passwordKey。"
    return
  }

  Push-Location $WorkDir
  try {
    $output = $password | & $Uv run --project $WorkDir python -m app.cli ensure-user --username $userName --role $Role.ToLowerInvariant() --password-stdin 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "$Role 账号初始化失败：$output"
    }
    Write-Host ("$Role 账号就绪：" + ($output -join " "))
  } finally {
    Pop-Location
  }
}

function Stop-LocalProcess([System.Diagnostics.Process]$Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    & taskkill /PID $Process.Id /T /F | Out-Null
  }
}

try {
  $uv = Resolve-Executable "uv"
  $corepack = Resolve-Executable "corepack"
  Set-Location $rootDir
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  & $uv sync --project apps/api --frozen
  if ($LASTEXITCODE -ne 0) { throw "Python 依赖同步失败。" }
  & $corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "前端依赖同步失败。" }

  Ensure-InitialUser $uv (Join-Path $rootDir "apps/api") $rootDir "admin"
  Ensure-InitialUser $uv (Join-Path $rootDir "apps/api") $rootDir "contributor"

  $apiOut = Join-Path $logDir "api.log"
  $apiErr = Join-Path $logDir "api-error.log"
  $webOut = Join-Path $logDir "web.log"
  $webErr = Join-Path $logDir "web-error.log"
  $apiWorkDir = Join-Path $rootDir "apps/api"

  $apiProcess = Start-Process -FilePath $uv -WorkingDirectory $apiWorkDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr `
    -ArgumentList @("run", "--", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", $ApiPort)
  $webProcess = Start-Process -FilePath $corepack -WorkingDirectory $rootDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $webOut -RedirectStandardError $webErr `
    -ArgumentList @("pnpm", "--dir", "apps/web", "dev", "--host", "0.0.0.0", "--port", $WebPort)

  Write-Host "本地服务已启动："
  Write-Host "  前端：http://127.0.0.1:$WebPort"
  Write-Host "  API：http://127.0.0.1:$ApiPort/docs"
  Write-Host "  日志：$logDir"
  Write-Host "按 Ctrl+C 同时停止前后端服务。"

  Wait-Process -Id $apiProcess.Id, $webProcess.Id
} finally {
  Stop-LocalProcess $apiProcess
  Stop-LocalProcess $webProcess
}
