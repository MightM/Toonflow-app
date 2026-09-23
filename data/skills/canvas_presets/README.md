<!--
资产画布「目标模板」。每个 .md（本文件除外）是一个模板：开头 --- 包裹的是配置，后面是提示词正文。
配置项（key: value，一行一个）：
  name        模板名称
  group       分组：人物 / 场景 / 道具 / 通用
  icon        IconPark 图标名（不带 i- 前缀），如 people、landscape、cube
  desc        一句话说明
  targets     适用节点，逗号分隔：image（自由图片节点）、role、scene、tool（资产节点）
  binding     资产模型绑定 key；写成 a|b 表示「无参考用 a，有参考用 b」。可用：roleSheet roleSheetRef roleDerive scene sceneDerive prop propDerive
  model       没有 binding 或 binding 未配置模型时的默认模型，如 comfyui:krea2_portrait；也可写成 a|b
  ratio       默认比例，如 16:9
  size        默认分辨率：1K / 2K / 4K
  requiresRef true = 必须先连入参考图
  optional  true = 正文里的 {{需求}} 可以留空（模板本身已是完整指令，如镜头推拉），不填也能生成
  polish      「扩写」用的视觉手册文件名（取项目画风目录下的 art_prompt），如 art_character
  hint        输入框占位提示
  order       排序（数字小的在前）
  pre         前置步骤的模板 id：生成时先按它出一张中间图（只进历史），成功后自动作为本模板的参考图（如人物换装 = 换装定妆照 → 设定图）
  hidden      true = 只作前置步骤，不在选择面板里显示
正文占位符：{{需求}} 用户输入；{{ratio}} 比例；{{orientation}} 横向 / 竖向；{{include:文件名}} 引入 data/skills/ 下的文件（HTML 注释会被去掉）。
改完即时生效，不用重启。
-->
