# deploy/

安装包（electron-builder `extraResources`）里带的 Windows 收尾脚本，装到 `resources\deploy\`。**这里是副本**，源头在工作区：
`vendor-comfyui/deploy/deploy-canvas.ps1`、`vendor-comfyui/deploy/set-toonflow-launch.ps1`、`story-skills/apply-script-genre-patches.ps1`、
`story-skills/script-genre-patches/`；`deploy-windows.sh` 每次会把它们同步过来，别在这里直接改。

装完安装包、启动过一次后，在目标机器上跑：

```
powershell -ExecutionPolicy Bypass -File "D:\toonflow\resources\deploy\deploy-canvas.ps1" -PostInstall [-ComfyUrl http://127.0.0.1:7878]
```

它会把 ComfyUI 供应商代码与地址、H3 提示词绑定、资产模型默认值写进数据库，并把剧本题材章节追加进全局 `script_*.md`。API Key 仍需在设置里手动填。
