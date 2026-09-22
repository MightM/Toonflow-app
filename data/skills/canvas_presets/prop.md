---
name: 道具三视图
group: 道具
icon: cube
desc: 同一道具在转台上的 0° / +120° / −120° 三视图，浅灰影棚背景
targets: image, tool
binding: prop|propRef
model: comfyui:krea2_t2i|comfyui:krea2_restyle
ratio: 16:9
size: 1K
polish: art_prop
hint: 写道具的名称、尺寸、形状结构、材质、颜色、纹样、磨损痕迹，如「民国黄铜怀表，直径约5厘米，表盖雕花，链子微微氧化」；连一张参考图就照它的样式重画
order: 70
---
根据以下需求生成同一个物品的三视图参考图，用于后续分镜图和参考生视频：

【道具需求】
{{需求}}

{{include:asset_prop_sheet_format.md}}
