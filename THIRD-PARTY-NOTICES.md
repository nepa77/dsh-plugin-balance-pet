# Third-party notices

This repository's own code is MIT (see [LICENSE](LICENSE)). The **character artwork is
not** — it is third-party work, redistributed here so the plugin works out of the box.
This file records exactly where each image comes from, what its upstream terms are, and
how to check that the copies here have not been altered.

If you are a rights holder and want something changed or removed, open an issue and it
will be dealt with.

## Where each file comes from

All artwork was taken from [VKmich16/VK-1](https://github.com/VKmich16/VK-1) at commit
`9ab36bd2fa9ff13b0b832f98a7c0f240aa0cf36d`, downscaled to the sizes below, and converted to
WebP. Nothing was redrawn, recoloured or otherwise edited. The resize is the only change.

| File here | Upstream path in VKmich16/VK-1 | Upstream size | Shipped size |
|---|---|---|---|
| `assets/expression-11.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_11.png` | 1024 × 1024 | 768 × 768 |
| `assets/expression-12.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_12.png` | 1024 × 1024 | 768 × 768 |
| `assets/expression-21.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_21.png` | 1024 × 1024 | 768 × 768 |
| `assets/expression-22.webp` | `大肥鱼桌宠改_D-16BVM/sprites/expression_22.png` | 1024 × 1024 | 768 × 768 |
| `assets/appearance-bowl.webp` | `dsh-balance-pet-macos/Resources/sprite-deepseek-offline.png` | 1536 × 1024 | 1152 × 768 |
| `assets/appearance-gpt.webp` | `dsh-balance-pet-macos/Resources/sprite-gpt.png` | 1536 × 1024 | 1152 × 768 |
| `assets/appearance-claude.webp` | `dsh-balance-pet-macos/Resources/sprite-claude.png` | 1536 × 1024 | 1152 × 768 |
| `assets/appearance-gemini.webp` | `dsh-balance-pet-macos/Resources/sprite-gemini.png` | 1536 × 1024 | 1152 × 768 |

## Upstream terms, as published

Three different statements apply, and they are not identical:

1. **VKmich16/VK-1 root README — MIT, plus an explicit invitation.**
   The repository is MIT (`Copyright (c) 2026 VKmich16`). Its licence section lists
   `dsh-balance-pet-macos/` and `output/` as **outside** that MIT, crediting the macOS port
   to [@Andromedahk](https://github.com/Andromedahk) — and then says, quoting:

   > 想把这里的素材用在自己的项目（包括移植到别的平台）：注明来源即可，无需另行询问。
   >
   > *(Want to use the assets here in your own project, including porting to another
   > platform? Just credit the source, no need to ask.)*

   That last line is the permission this repository relies on, and this file plus the
   README's attribution is the credit it asks for.

2. **`dsh-balance-pet-macos/Resources/README.md` (the macOS port, maintained by
   @Andromedahk) — provenance note, no grant.** It records that the upstream original
   author handles the UI images, that upstream has not attached a licence, and that it
   does not itself grant a licence for the upstream code, assets or derived images.

3. **`VKmich16/V`, the original Windows pet** — no licence file. This is the root of the
   chain and the reason (2) declines to grant anything.

So the position of this repository is deliberately the same one the upstream authors took:
**the artwork is redistributed with attribution and without this repository asserting any
licence over it.** Nothing here re-licenses it, and nothing here claims it as original work.
If you need certainty for commercial use, ask the authors above — do not rely on this file.

The four `expression-*` images come from VKmich16's own directory, which its MIT does cover;
the four `appearance-*` images come from the macOS directory, which it does not, and are
covered only by the invitation quoted in (1).

## Verifying the copies

`tools/make-assets.py` regenerates every image from the originals and, before writing
anything, checks each source file against the **git blob id published by GitHub** for that
path. Those ids were:

| Upstream file | git blob id |
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

(`外观/` and `四个差分表情/` are the folder names this project received the files under;
they correspond to `dsh-balance-pet-macos/Resources/` and
`大肥鱼桌宠改_D-16BVM/sprites/` upstream.)

The **tablet corner coordinates** in `src/client.js` (`ART_DEEPSEEK`, `ART_WIDE`,
`ART_WIDE_GEMINI`) are also derived from upstream: the 1024 × 1024 numbers are the D-16BVM
build's own sprite constants, and the 1536 × 1024 numbers are the macOS build's measured
corners. They are facts about the images, not expressive content.
