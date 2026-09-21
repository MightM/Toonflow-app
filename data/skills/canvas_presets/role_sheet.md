---
name: 角色设定图
group: 人物
icon: people
desc: 主大头照 + 正面 / 侧面 / 背面全身
targets: image, role
binding: roleSheet|roleSheetRef
model: comfyui:krea2_t2i|comfyui:krea2_4view
ratio: 16:9
size: 1K
polish: art_character
hint: 写人物需求：身份与造型（写到鞋款）/ 脸部特征 / 主大头照表情 / 画风；只写一句也行，点「扩写」按视觉手册补全
order: 10
---
根据以下需求生成一张专业人物多视图：

【人物需求】
{{需求}}

{{include:asset_character_sheet_format.md}}
