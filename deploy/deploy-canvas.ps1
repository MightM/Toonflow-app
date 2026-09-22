# 在 Windows 上部署整套改造（由 Mac 的 deploy-windows.sh 拷贝并调用，也可手动跑）：
# 停 ToonFlow → 备份 data\{serve,web,skills,modelPrompt,db2.sqlite} → 覆盖 serve/web/skills/modelPrompt →
# 启动 ToonFlow → 等端口 → 更新 comfyui 供应商代码 + 输入 → 绑定 5 份 H3 提示词 → 设资产模型全局默认 → 追加剧本题材补丁
#
# data\skills 是用户会自己编辑的目录，默认「只增不改」：已有文件一律不动、不删，只补 Mac 有而 Windows 没有的文件。
# 要把某套手册的更新推过去，显式给 -OverwriteSkills（skills 下的相对路径前缀，多个用逗号；"*" = 全部同路径覆盖）：
#   deploy-canvas.ps1 -OverwriteSkills art_skills\3D_urban_allure,story_skills\Urban_sensual_drama
# 剧本题材补丁同理：默认只追加 Windows 上还没有的章节；-UpdateGenrePatches 才替换已有章节。
#
# -PostInstall：装完安装包后的收尾模式（安装包已把 serve / web / skills / modelPrompt / vendor 带进数据目录），
# 不停、不备份、不拷文件，只做启动 → 写库（供应商代码与地址、H3 提示词绑定、资产模型、剧本题材章节）。
# 安装后在目标机器上跑：powershell -ExecutionPolicy Bypass -File "D:\toonflow\resources\deploy\deploy-canvas.ps1" -PostInstall
param(
  [string]$User = "admin",
  [string]$Password = "admin123",
  [string]$ComfyUrl = "http://127.0.0.1:7878",
  [string]$Exe = "D:\toonflow\ToonFlow.exe",
  # Electron 启动参数：默认关掉 GPU 硬件加速，避免 ComfyUI 出图占满显卡时整个窗口卡住（同时写进桌面快捷方式）
  [string]$LaunchArgs = "--disable-gpu",
  [switch]$SkipBackup,
  [string[]]$OverwriteSkills = @(),
  [switch]$UpdateGenrePatches,
  [switch]$PostInstall
)
# -File 方式传进来的数组可能是一个带逗号的字符串，拆开并统一成反斜杠
$OverwriteSkills = @($OverwriteSkills | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim().Replace("/", "\") } | Where-Object { $_ })
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:APPDATA "ToonFlow\data"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Get-ToonFlowPort {
  $pids = @(Get-Process ToonFlow -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $pids) { return 0 }
  $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess } | Select-Object -ExpandProperty LocalPort)
  if ($ports) { return [int]$ports[0] } else { return 0 }
}

# 1. 停掉 ToonFlow（收尾模式不停：跑着就直接用，没跑就在第 4 步拉起）
if (-not $PostInstall -and (Get-Process ToonFlow -ErrorAction SilentlyContinue)) {
  "stopping ToonFlow"
  Get-Process ToonFlow -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 3
}

# 2. 备份
if (-not $SkipBackup -and -not $PostInstall) {
  $backup = Join-Path $env:APPDATA "ToonFlow\backup-$stamp"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  foreach ($name in @("serve", "web", "skills", "modelPrompt")) {
    $src = Join-Path $data $name
    if (Test-Path $src) { Copy-Item $src (Join-Path $backup $name) -Recurse -Force }
  }
  Copy-Item (Join-Path $data "db2.sqlite") (Join-Path $backup "db2.sqlite") -Force
  "backup: $backup"
}

# 3. 覆盖文件（收尾模式跳过：文件已由安装包放好）
if ($PostInstall) { "post-install mode: files already installed, skip copy" }
else {
Copy-Item (Join-Path $dir "serve\app.js") (Join-Path $data "serve\app.js") -Force
Copy-Item (Join-Path $dir "web\*") (Join-Path $data "web") -Force
# skills（视觉手册 / 导演手册 / 画布模板 / 生产技能等）只增不改：已有文件一律不动，只补缺的；Windows 独有的文件与目录一律保留
# 只有 -OverwriteSkills 命中的路径前缀才覆盖同路径文件。全局 script_*.md 不在这里动（第 8 步按章节追加）
function Merge-Tree([string]$from, [string]$to, [string[]]$skipNames, [string[]]$overwrite) {
  $stat = @{ updated = 0; added = 0; skipped = 0 }
  Get-ChildItem $from -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($from.Length).TrimStart("\")
    if ($skipNames | Where-Object { $rel -like $_ }) { return }
    $dest = Join-Path $to $rel
    if (Test-Path -LiteralPath $dest) {
      $hit = $overwrite | Where-Object { $_ -eq "*" -or $rel -like "$_*" }
      if (-not $hit) { $stat.skipped++; return }
      $stat.updated++
    } else { $stat.added++ }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  }
  $kept = @(Get-ChildItem $to -Recurse -File | Where-Object { -not (Test-Path -LiteralPath (Join-Path $from $_.FullName.Substring($to.Length).TrimStart("\"))) }).Count
  "{0}: updated {1}, added {2}, skipped {3} (existing, untouched), kept {4} (only on Windows)" -f (Split-Path -Leaf $to), $stat.updated, $stat.added, $stat.skipped, $kept
}
Merge-Tree (Join-Path $dir "skills") (Join-Path $data "skills") @("script_*.md") $OverwriteSkills
# modelPrompt\video 是 H3 提示词模板，第 6 步会把它们入库绑定，保持同路径覆盖
Merge-Tree (Join-Path $dir "modelPrompt") (Join-Path $data "modelPrompt") @() @("*")
"files copied"
}

# 4. 启动 ToonFlow（SSH 里直接 Start-Process 会落到非交互会话，用计划任务在登录会话里拉起）
if ($PostInstall -and (Get-ToonFlowPort)) {
  & (Join-Path $dir "set-toonflow-launch.ps1") -Exe $Exe -LaunchArgs $LaunchArgs
  "ToonFlow already running"
} else {
  & (Join-Path $dir "set-toonflow-launch.ps1") -Exe $Exe -LaunchArgs $LaunchArgs -Start
}
$port = 0
for ($i = 0; $i -lt 40 -and -not $port; $i++) { Start-Sleep -Seconds 2; $port = Get-ToonFlowPort }
if (-not $port) { throw "ToonFlow 启动后没探测到端口：请手动打开 ToonFlow，再单独跑 deploy-windows.ps1 与 apply-script-genre-patches.ps1" }
"ToonFlow port: $port"
Start-Sleep -Seconds 5
$base = "http://127.0.0.1:$port/api"

function Invoke-ToonFlow([string]$path, $body, [string]$token) {
  $headers = @{}
  if ($token) { $headers["Authorization"] = $token }
  $json = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10 -Compress))
  try {
    $resp = Invoke-WebRequest -Uri "$base$path" -Method Post -ContentType "application/json; charset=utf-8" -Headers $headers -Body $json -UseBasicParsing
    $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
  } catch {
    $stream = $_.Exception.Response.GetResponseStream()
    $text = (New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)).ReadToEnd()
  }
  return $text | ConvertFrom-Json
}
function Step([string]$name, $result) {
  "{0}: code={1} message={2}" -f $name, $result.code, $result.message
  if ($result.code -ne 200) { throw "$name failed" }
}

$login = $null
for ($i = 0; $i -lt 10 -and -not $login; $i++) {
  try { $login = Invoke-ToonFlow "/login/login" @{ username = $User; password = $Password } $null } catch { Start-Sleep -Seconds 3 }
}
Step "login" $login
$token = $login.data.token

# 5. comfyui 供应商：更新代码（模型列表以库为准，新模型 / 1080P / tts 靠这一步进库）
# 收尾模式下供应商脚本和 H3 模板取数据目录里安装包放好的那份；部署模式取 stage 里拷来的
$comfyCode = if ($PostInstall) { Join-Path $data "vendor\comfyui.ts" } else { Join-Path $dir "comfyui.ts" }
$promptDir = if ($PostInstall) { Join-Path $data "modelPrompt\video" } else { Join-Path $dir "modelPrompt\video" }
$code = [IO.File]::ReadAllText($comfyCode, [Text.Encoding]::UTF8)
$vendors = Invoke-ToonFlow "/setting/vendorConfig/getVendorList" @{} $token
$exists = @($vendors.data | Where-Object { $_.id -eq "comfyui" }).Count -gt 0
if ($exists) { Step "updateCode" (Invoke-ToonFlow "/setting/vendorConfig/updateCode" @{ id = "comfyui"; tsCode = $code } $token) }
else { Step "addVendor" (Invoke-ToonFlow "/setting/vendorConfig/addVendor" @{ tsCode = $code } $token) }
$inputs = @{ baseUrl = $ComfyUrl; token = ""; workflowDir = "api"; imageTimeoutMinutes = "30"; videoTimeoutMinutes = "180" }
Step "updateVendorInputs" (Invoke-ToonFlow "/setting/vendorConfig/updateVendorInputs" @{ id = "comfyui"; inputValues = $inputs } $token)
Step "enableVendor" (Invoke-ToonFlow "/setting/vendorConfig/enableVendor" @{ id = "comfyui"; enable = 1 } $token)

# 6. H3 提示词：5 份模板入库并绑定（segment / text 两份只入库，按模型名自动匹配）
$prompts = @(
  @{ model = "h3_i2v"; name = "minimaxH3FirstFrameMode" },
  @{ model = "h3_ref2v"; name = "minimaxH3ReferenceMode" },
  @{ model = "h3_ref2v_multi"; name = "minimaxH3ReferenceMultiMode" },
  @{ model = "h3_t2v"; name = "minimaxH3TextMode" },
  @{ model = ""; name = "minimaxH3SegmentMode" }
)
foreach ($p in $prompts) {
  $md = [IO.File]::ReadAllText((Join-Path $promptDir "$($p.name).md"), [Text.Encoding]::UTF8)
  Step "savePrompt $($p.name)" (Invoke-ToonFlow "/setting/modelMap/savePrompt" @{ name = $p.name; type = "video"; data = $md } $token)
  if ($p.model) { Step "bindingPrompt $($p.model)" (Invoke-ToonFlow "/setting/modelMap/bindingPrompt" @{ vendorId = "comfyui"; model = $p.model; path = "video/$($p.name).md"; fileName = "$($p.name).md" } $token) }
}

# 7. 资产模型全局默认（实测结论：roleSheet=t2i、roleSheetRef=4view、roleDerive=edit）：在现有全局配置上只改这三项
$current = Invoke-ToonFlow "/setting/assetModels/getAssetModels" @{ projectId = $null } $token
$models = @{}
$source = if ($current.data.effective) { $current.data.effective } else { $current.data.global }
foreach ($prop in $source.PSObject.Properties) { $models[$prop.Name] = @{ model = $prop.Value.model; aspectRatio = $prop.Value.aspectRatio } }
foreach ($pair in @(@("roleSheet", "comfyui:krea2_t2i"), @("roleSheetRef", "comfyui:krea2_4view"), @("roleDerive", "comfyui:krea2_edit"))) {
  if (-not $models[$pair[0]]) { $models[$pair[0]] = @{ aspectRatio = "16:9" } }
  $models[$pair[0]].model = $pair[1]
  if (-not $models[$pair[0]].aspectRatio) { $models[$pair[0]].aspectRatio = "16:9" }
}
Step "setAssetModels" (Invoke-ToonFlow "/setting/assetModels/setAssetModels" @{ projectId = $null; models = $models } $token)

# 8. 剧本题材补丁：按 script-genre-patches/<题材>/ 追加进全局 script_*.md。默认只追加 Windows 上没有的章节；-UpdateGenrePatches 才替换已有章节
$patchScript = Join-Path $dir "apply-script-genre-patches.ps1"
if (Test-Path $patchScript) {
  $patchArgs = @{ PatchDir = (Join-Path $dir "script-genre-patches") }
  if ($UpdateGenrePatches) { $patchArgs.UpdateExisting = $true }
  & $patchScript @patchArgs
} else { "genre patches: script not staged, skipped" }

# 9. 冒烟
$styles = Invoke-ToonFlow "/canvas/listArtStyles" @{} $token
"artStyles: $(@($styles.data).Count)"
$models = Invoke-ToonFlow "/modelSelect/getModelList" @{ type = "video" } $token
"video models: " + (($models.data | ForEach-Object { $_.value }) -join ",")
$tts = Invoke-ToonFlow "/modelSelect/getModelList" @{ type = "tts" } $token
"tts models: " + (($tts.data | ForEach-Object { $_.value }) -join ",")
"deploy done (port $port)"
