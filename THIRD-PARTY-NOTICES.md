# 第三方素材声明

本仓库自己的代码是 MIT（见 [LICENSE](LICENSE)）。**角色素材不是**——它们是第三方作品，
放在这里是为了让插件开箱可用。本文件记录每张图的确切来源、上游各自的条款、
以及如何核验这里的副本没有被改动过。

如果你是权利人要改什么或要求移除，开一个 issue 即可处理。

## 每张图的来源

所有素材取自 [VKmich16/VK-1](https://github.com/VKmich16/VK-1) 的
commit `9ab36bd2fa9ff13b0b832f98a7c0f240aa0cf36d`，按下表尺寸缩小并转成 WebP。
**没有重绘、没有改色、没有其他任何编辑，缩放是唯一的改动。**

| 这里的文件 | 在 VKmich16/VK-1 里的路径 | 上游尺寸 | 随包尺寸 |
|---|---|---|---|
| `assets/expression-11.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_11.png` | 1024 × 1024 | 768 × 768 |
| `assets/expression-12.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_12.png` | 1024 × 1024 | 768 × 768 |
| `assets/expression-21.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_21.png` | 1024 × 1024 | 768 × 768 |
| `assets/expression-22.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_22.png` | 1024 × 1024 | 768 × 768 |
| `assets/appearance-bowl.webp` | `dsh-balance-pet-macos/Resources/sprite-deepseek-offline.png` | 1536 × 1024 | 1152 × 768 |
| `assets/appearance-gpt.webp` | `dsh-balance-pet-macos/Resources/sprite-gpt.png` | 1536 × 1024 | 1152 × 768 |
| `assets/appearance-claude.webp` | `dsh-balance-pet-macos/Resources/sprite-claude.png` | 1536 × 1024 | 1152 × 768 |
| `assets/appearance-gemini.webp` | `dsh-balance-pet-macos/Resources/sprite-gemini.png` | 1536 × 1024 | 1152 × 768 |

## 上游各自的条款（照原文搬运）

有三份不同的说法，而且它们并不一致：

1. **VKmich16/VK-1 的根 README——MIT，外加一句明确的邀请。**
   该仓库采用 MIT（`Copyright (c) 2026 VKmich16`）。它的许可章节把 `dsh-balance-pet-macos/`
   和 `output/` 列为**不在** MIT 范围内，并把 macOS 版归给
   [@Andromedahk](https://github.com/Andromedahk) 独立维护——然后写了这句，原文引用：

   > 想把这里的素材用在自己的项目（包括移植到别的平台）：注明来源即可，无需另行询问。

   **本仓库依赖的授权就是这一句**；而本文件加上 README 里的署名，就是它要求的「注明来源」。

2. **`dsh-balance-pet-macos/Resources/README.md`（macOS 版，@Andromedahk 维护）——
   只保留来源说明，不作授权。** 它写明 UI 图片由上游原作者处理、上游暂未附许可证，
   并且它自己也不对上游代码、素材或衍生图片另行授予许可。

3. **`VKmich16/V`，最初的 Windows 原版——没有许可证文件。** 它是这条链的根，
   也是第 2 条拒绝授权的原因。

所以本仓库的立场**刻意和上游作者保持一致**：**素材在注明来源的前提下再分发，本仓库不对其主张任何许可。**
这里没有任何东西对它重新授权，也没有任何东西声称它是原创。**如果你需要商用层面的确定性，
请去问上面那两位作者，不要依赖这份文件。**

四张 `expression-*` 来自 VKmich16 自己的目录，其 MIT 覆盖得到；四张 `appearance-*` 来自 macOS 目录，
其 MIT 不覆盖，只由第 1 条那句邀请覆盖。

## 如何核验这些副本

`tools/make-assets.py` 会从原图重新生成每一张图，并且在写入任何文件**之前**，
把每个源文件与 **GitHub 为该路径发布的 git blob id** 逐一比对。这些 id 是：

| 上游文件 | git blob id |
|---|---|
| `外观/sprite.png` | `0cf081ad4226b40ac745523c4866acb712c6cd99` |
| `外观/sprite-gpt.png` | `66a73e8543884c5b6ae679b897c7edf2859bbdbc` |
| `外观/sprite-claude.png` | `bf12181516b132b5d191ac64e30929c9355af667` |
| `外观/sprite-gemini.png` | `9a75b26f0583cec30db0655657c8e68cce209cf4` |
| `外观/sprite-deepseek-offline.png` | `346dd449236a409bb9763adff24a6de9400e31d7` |
| `四个差分表情/expression_11.png` | `bfc234a670be2e22db61b43235e17f27c15704ba` |
| `四个差分表情/expression_12.png` | `01e4c9d3743d75c03964d5e35df49c512ea61b05` |
| `四个差分表情/expression_21.png` | `2576111000016fc08ef6080cbef49979e4eeb974` |
| `四个差分表情/expression_22.png` | `8192e78b4ead83d21915622cdd408ead2ce0cc4f` |

（`外观/` 和 `四个差分表情/` 是这套文件拿到手时的目录名，对应上游的
`dsh-balance-pet-macos/Resources/` 和 `大肥鱼桌宠改_D-16BVM/sprites/`。）

`src/client.js` 里的**平板角点坐标**（`ART_DEEPSEEK`、`ART_WIDE`、`ART_WIDE_GEMINI`）
同样源自上游：1024 × 1024 那组数字是 D-16BVM 构建自己的 sprite 常量，
1536 × 1024 那组是 macOS 构建量出来的角点。它们是关于图片的事实，不是表达性内容。
