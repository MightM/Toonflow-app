---
name: 人物换装
group: 人物
icon: clothes-sweater
desc: 两步自动完成：先在参考图上换装出一张换装定妆照，再以它为参考生成角色设定图
targets: image, role
binding: roleSheetRef
model: comfyui:krea2_4view
ratio: 16:9
size: 1K
requiresRef: true
pre: role_outfit_edit
polish: art_character_derivative
hint: 描述要换的服装、妆容、发型、鞋款、配饰（鞋款写明，否则容易沿用原鞋），如「换成黑色机车皮衣、白T、破洞牛仔裤、黑色马丁靴」
order: 30
---
根据以下需求生成一张专业人物多视图：

【人物需求】
以参考图1中的人物为唯一身份母版，脸、发型、服装、鞋履与配饰都与参考图1完全一致：
{{需求}}

{{include:asset_character_sheet_format.md}}
