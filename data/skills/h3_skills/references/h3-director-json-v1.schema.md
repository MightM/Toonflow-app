# h3-director-json-v1 Schema

> 结构真值。ToonFlow 不输出 JSON 提示词，这份只作字段与枚举的依据。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:h3-director-json:v1",
  "title": "H3 Director JSON v1",
  "description": "Community-authored director prompt structure for MiniMax H3. This is not an official MiniMax API schema. Reference roles encode independent responsibilities; identity/environment preservation does not imply source composition preservation unless a concrete frame or composition reference is also supplied.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "format",
    "direction",
    "storyboard",
    "audio"
  ],
  "properties": {
    "schema": {
      "const": "h3-director-json-v1"
    },
    "format": {
      "$ref": "#/$defs/format"
    },
    "material_assets": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/materialAsset"
      }
    },
    "references": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/reference"
      }
    },
    "direction": {
      "$ref": "#/$defs/direction"
    },
    "storyboard": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/shot"
      }
    },
    "audio": {
      "$ref": "#/$defs/audio"
    },
    "exclusions": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/nonEmptyString"
      }
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "format": {
            "properties": {
              "mode": {
                "const": "T2VA"
              }
            },
            "required": [
              "mode"
            ]
          }
        }
      },
      "then": {
        "not": {
          "required": [
            "references"
          ]
        }
      }
    },
    {
      "if": {
        "properties": {
          "format": {
            "properties": {
              "mode": {
                "enum": [
                  "I2VA",
                  "FL2VA",
                  "L2VA",
                  "Ref2VA"
                ]
              }
            },
            "required": [
              "mode"
            ]
          }
        }
      },
      "then": {
        "required": [
          "references"
        ]
      }
    }
  ],
  "$defs": {
    "nonEmptyString": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    },
    "label": {
      "type": "string",
      "pattern": "^<(Picture|Video|Audio|Subject) [1-9][0-9]*>$"
    },
    "assetLabel": {
      "type": "string",
      "pattern": "^<(Picture|Video|Audio) [1-9][0-9]*>$"
    },
    "visualAssetLabel": {
      "type": "string",
      "pattern": "^<(Picture|Video) [1-9][0-9]*>$"
    },
    "audioLabel": {
      "type": "string",
      "pattern": "^<Audio [1-9][0-9]*>$"
    },
    "format": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode",
        "duration_seconds",
        "aspect_ratio",
        "total_shots"
      ],
      "properties": {
        "mode": {
          "enum": [
            "T2VA",
            "I2VA",
            "FL2VA",
            "L2VA",
            "Ref2VA"
          ]
        },
        "duration_seconds": {
          "type": "number",
          "minimum": 4,
          "maximum": 15
        },
        "aspect_ratio": {
          "type": "string",
          "pattern": "^[1-9][0-9]*:[1-9][0-9]*$"
        },
        "total_shots": {
          "type": "integer",
          "minimum": 1
        },
        "task_types": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "enum": [
              "keyframe completion",
              "reference generation",
              "video editing",
              "video continuation",
              "audio reuse",
              "audio reference"
            ]
          }
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "mode": {
                "const": "Ref2VA"
              }
            },
            "required": [
              "mode"
            ]
          },
          "then": {
            "required": [
              "task_types"
            ]
          },
          "else": {
            "not": {
              "required": [
                "task_types"
              ]
            }
          }
        }
      ]
    },
    "reference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "label",
        "role",
        "scope",
        "description"
      ],
      "properties": {
        "label": {
          "$ref": "#/$defs/label"
        },
        "sources": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/visualAssetLabel"
          }
        },
        "role": {
          "enum": [
            "opening_frame",
            "ending_frame",
            "keyframe",
            "composition_reference",
            "storyboard_reference",
            "subject_source",
            "source_video",
            "continuation_source",
            "action_reference",
            "camera_reference",
            "editing_reference",
            "rhythm_reference",
            "audio_reuse",
            "music_reference",
            "voice_reference",
            "dialogue_reference",
            "sound_reference",
            "continuity_reference",
            "character_identity",
            "product_identity",
            "object_identity",
            "environment_identity",
            "wardrobe_identity",
            "style_reference",
            "pose_reference"
          ]
        },
        "scope": {
          "enum": [
            "global",
            "shot_specific"
          ]
        },
        "shots": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "integer",
            "minimum": 1
          }
        },
        "at_seconds": {
          "type": "number",
          "minimum": 0
        },
        "relationship": {
          "enum": [
            "fully_preserved",
            "partially_preserved",
            "attribute_transfer",
            "weak_reference",
            "fully_copy",
            "partially_copy",
            "reference"
          ]
        },
        "description": {
          "$ref": "#/$defs/nonEmptyString"
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "scope": {
                "const": "shot_specific"
              }
            },
            "required": [
              "scope"
            ]
          },
          "then": {
            "required": [
              "shots"
            ]
          },
          "else": {
            "not": {
              "required": [
                "shots"
              ]
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Picture "
              }
            },
            "required": [
              "label"
            ]
          },
          "then": {
            "properties": {
              "role": {
                "enum": [
                  "opening_frame",
                  "ending_frame",
                  "keyframe",
                  "composition_reference",
                  "storyboard_reference",
                  "subject_source"
                ]
              },
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved",
                  "attribute_transfer",
                  "weak_reference"
                ]
              }
            },
            "not": {
              "required": [
                "sources"
              ]
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Video "
              }
            },
            "required": [
              "label"
            ]
          },
          "then": {
            "properties": {
              "role": {
                "enum": [
                  "source_video",
                  "continuation_source",
                  "action_reference",
                  "camera_reference",
                  "editing_reference",
                  "rhythm_reference",
                  "subject_source"
                ]
              },
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved",
                  "attribute_transfer",
                  "weak_reference"
                ]
              }
            },
            "not": {
              "required": [
                "sources"
              ]
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Audio "
              }
            },
            "required": [
              "label"
            ]
          },
          "then": {
            "properties": {
              "role": {
                "enum": [
                  "audio_reuse",
                  "music_reference",
                  "voice_reference",
                  "dialogue_reference",
                  "rhythm_reference",
                  "sound_reference",
                  "continuity_reference"
                ]
              },
              "relationship": {
                "enum": [
                  "fully_copy",
                  "partially_copy",
                  "reference",
                  "weak_reference"
                ]
              }
            },
            "not": {
              "required": [
                "sources"
              ]
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Subject "
              }
            },
            "required": [
              "label"
            ]
          },
          "then": {
            "required": [
              "sources"
            ],
            "properties": {
              "role": {
                "enum": [
                  "character_identity",
                  "product_identity",
                  "object_identity",
                  "environment_identity",
                  "wardrobe_identity",
                  "style_reference",
                  "action_reference",
                  "pose_reference"
                ]
              },
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved",
                  "attribute_transfer",
                  "weak_reference"
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "role": {
                "enum": [
                  "opening_frame",
                  "ending_frame",
                  "keyframe"
                ]
              }
            },
            "required": [
              "role"
            ]
          },
          "then": {
            "required": [
              "at_seconds"
            ],
            "properties": {
              "scope": {
                "const": "shot_specific"
              },
              "shots": {
                "maxItems": 1
              },
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved"
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Picture "
              },
              "role": {
                "enum": [
                  "composition_reference",
                  "storyboard_reference"
                ]
              }
            },
            "required": [
              "label",
              "role"
            ]
          },
          "then": {
            "properties": {
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved",
                  "weak_reference"
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Video "
              },
              "role": {
                "enum": [
                  "source_video",
                  "continuation_source"
                ]
              }
            },
            "required": [
              "label",
              "role"
            ]
          },
          "then": {
            "properties": {
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved"
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Video "
              },
              "role": {
                "enum": [
                  "camera_reference",
                  "editing_reference",
                  "rhythm_reference"
                ]
              }
            },
            "required": [
              "label",
              "role"
            ]
          },
          "then": {
            "properties": {
              "relationship": {
                "enum": [
                  "fully_preserved",
                  "partially_preserved",
                  "weak_reference"
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Audio "
              },
              "role": {
                "const": "audio_reuse"
              }
            },
            "required": [
              "label",
              "role"
            ]
          },
          "then": {
            "properties": {
              "relationship": {
                "enum": [
                  "fully_copy",
                  "partially_copy"
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "label": {
                "pattern": "^<Audio "
              },
              "role": {
                "enum": [
                  "music_reference",
                  "voice_reference",
                  "dialogue_reference",
                  "rhythm_reference",
                  "sound_reference",
                  "continuity_reference"
                ]
              }
            },
            "required": [
              "label",
              "role"
            ]
          },
          "then": {
            "properties": {
              "relationship": {
                "enum": [
                  "reference",
                  "weak_reference"
                ]
              }
            }
          }
        }
      ]
    },
    "direction": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "concept",
        "visual_style"
      ],
      "properties": {
        "concept": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "visual_style": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "subject": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "environment": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "visual_rhythm": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "continuity": {
          "$ref": "#/$defs/nonEmptyString"
        }
      }
    },
    "shot": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "shot",
        "start_seconds",
        "end_seconds",
        "camera",
        "action",
        "sfx"
      ],
      "properties": {
        "shot": {
          "type": "integer",
          "minimum": 1
        },
        "start_seconds": {
          "type": "number",
          "minimum": 0
        },
        "end_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "camera": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "action": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "sfx": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "references": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/label"
          }
        },
        "dialogue": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/dialogue"
          }
        },
        "visible_text": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/visibleText"
          }
        }
      }
    },
    "dialogue": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "speaker",
        "delivery",
        "line"
      ],
      "properties": {
        "speaker": {
          "type": "string",
          "pattern": "^S[1-9][0-9]*(,S[1-9][0-9]*)*$"
        },
        "delivery": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "line": {
          "type": "string",
          "pattern": "^<d>\\[[^\\]\\r\\n]+\\]\\s+.+</d>$"
        }
      }
    },
    "visibleText": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "content",
        "placement"
      ],
      "properties": {
        "content": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "placement": {
          "$ref": "#/$defs/nonEmptyString"
        }
      }
    },
    "audio": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "overall_soundscape",
        "non_diegetic_music"
      ],
      "properties": {
        "overall_soundscape": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "non_diegetic_music": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "sync_basis": {
          "oneOf": [
            {
              "$ref": "#/$defs/plannedBeat"
            },
            {
              "$ref": "#/$defs/audioReference"
            },
            {
              "$ref": "#/$defs/audioReuse"
            }
          ]
        }
      }
    },
    "plannedBeat": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "bpm"
      ],
      "properties": {
        "type": {
          "const": "planned_beat"
        },
        "bpm": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "phase_seconds": {
          "type": "number",
          "minimum": 0,
          "exclusiveMaximum": 15
        }
      }
    },
    "audioReference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "source"
      ],
      "properties": {
        "type": {
          "const": "audio_reference"
        },
        "source": {
          "$ref": "#/$defs/audioLabel"
        },
        "bpm": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "phase_seconds": {
          "type": "number",
          "minimum": 0,
          "exclusiveMaximum": 15
        }
      }
    },
    "audioReuse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "source"
      ],
      "properties": {
        "type": {
          "const": "audio_reuse"
        },
        "source": {
          "$ref": "#/$defs/audioLabel"
        }
      }
    },
    "rawAssetLabel": {
      "type": "string",
      "pattern": "^<(Picture|Video|Audio) [1-9][0-9]*>$"
    },
    "materialAsset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "asset_id",
        "labels"
      ],
      "properties": {
        "asset_id": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "labels": {
          "type": "array",
          "minItems": 1,
          "maxItems": 2,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/rawAssetLabel"
          }
        }
      }
    }
  }
}

---

## 附录：scripts/ 与 tests/ 说明（完整源码见 zip 包）

- scripts/validate_h3_prompt.py — 提示词验证器：校验 h3-director-json-v1 结构、dialogue 字段 `<d>[Language] text</d>` 正则格式、时长路由门（4-15s 单段 / >15s 切分总和校验）、参考素材上限等。用法：`python scripts/validate_h3_prompt.py --input "prompt.json"`；多段校验：`--requested-total-duration 20 --segment-durations 15,5`。
- scripts/check_h3_seam.py — 段间衔接光度辅助检查工具（生成真实片段后使用，不替代人工目检）。
- tests/test_validator.py — 验证器单元测试。
- agents/openai.yaml — OpenAI Agents 平台接入配置。

> 台词安全提示：H3 文本编码器依靠 `<d>` 与 `</d>` 整体标签识别台词驱动 TTS。标签缺失或被拆分成单个字符（`<` `d` `>`）会导致语音胡言乱语。本 skill 的验证器会对 dialogue 字段做正则强校验，格式不完整直接报 ERROR。
```

