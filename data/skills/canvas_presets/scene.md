---
name: 场景三视图
group: 场景
icon: landscape
desc: 同一场景的俯视全景 + 正面远景 + 核心区域近景，无人物，做分镜和视频的场景参考
targets: image, scene
binding: scene
model: comfyui:krea2_t2i
ratio: 16:9
size: 1K
polish: art_scene
hint: 写地点、时代与时段、光线方向、空间布局、主要陈设和核心区域，如「深夜便利店门口，雨后地面反光，核心是收银台」
order: 50
---
根据以下需求生成同一个场景的三视图参考图，用于后续分镜图和参考生视频：

【场景需求】
{{需求}}

{{include:asset_scene_sheet_format.md}}
