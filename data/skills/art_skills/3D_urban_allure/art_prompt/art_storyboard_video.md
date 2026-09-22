# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `hyperrealistic 3D human render, sensual modern urban night, moody cinematic lighting, warm skin glow with subtle neon rim light, glossy fabric reflections, ultra-fine detail, mature adult characters` |
| **通用首尾帧模式（英文）** | `hyperrealistic 3D human render, sensual modern urban night, moody cinematic lighting, warm skin glow with subtle neon rim light, glossy fabric reflections, ultra-fine detail, shallow depth of field, slow deliberate camera movement, mature adult characters` |
| **Seedance 2.0（中文）** | `超写实3D真人渲染，都市夜色魅惑，电影级氛围灯光，肌肤暖光与霓虹边缘光，丝缎亮片材质反光，极致细节，成年角色` |

### 动态与尺度

- 动作以慢节奏为主：眼神停留、缓慢转身、抚发、指尖轻触、酒杯轻碰、高跟鞋落步；镜头以慢推、环绕、跟随为主。胁迫、打斗、追逐、救援段落可以换成急推、手持、甩镜，节奏由剧情决定
- 镜头可以停留在锁骨、肩背、腰线、臀腿曲线、乳沟、大腿、脚踝与高跟鞋等局部，用来撩拨观众
- 亲密动作直接拍：对视、耳语、坐上大腿、抵墙、深吻、扑倒在床、隔衣或贴肤抚摸、解扣、褪下肩带、脱去外衣、床单下相拥翻滚、事后相拥；拥吻与床戏可配缓推、环绕或升格
- 胁迫与救援直接拍：拖拽、压制、掐颈、撕扯衣物、扇耳光、恐惧与挣扎、破门而入、把人拉进怀里、拳脚相向、血迹与淤青；受害者的恐惧和反抗要拍出来，让观众替她揪心
- 家庭与日常段落：子女、父母出场用日常、家庭方式呈现，未成年角色不进入亲密段落
- 唯一不拍的：生殖器、女性乳头与性交动作本身——到那一步用床单、手臂、头发、前景物体遮挡，或改成剪影、关门、灯熄、窗外夜景
- 多人同框时在提示词里点出各自的区分特征（发色、体型、服装），避免模型把两张脸画成一张
