---
name: 场景状态变体
group: 场景
icon: switch
desc: 同一场景换时段或状态（夜景、雨天、被毁、重新布置…），沿用参考图的三视图版式
targets: image, scene
binding: sceneDerive
model: comfyui:krea2_edit
ratio: 16:9
size: 1K
requiresRef: true
polish: art_scene_derivative
hint: 描述与参考图相比的变化：时段、天气、光线，或陈设、损毁程度的改变
order: 60
---
以参考图1中的场景为准，保持画面版式（单图或三视图拼图）、每个视图的机位与透视，以及空间结构、建筑、陈设位置完全不变，只改变以下内容：
{{需求}}

各视图之间的时刻、光照方向与天气保持一致；画面中没有任何人物；无文字、无水印。
