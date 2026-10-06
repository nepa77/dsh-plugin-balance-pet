---
name: dsh-plugin-balance-pet
description: 当 DSH 余额桌宠出问题，或 DeepSeek Harness 升级之后使用——桌宠不见了、看不见或显示成灰色方块，余额一直不来，外观或表情不再切换，右键菜单打不开，扣费动画重复计数或不再触发，API Key 存不进去，或者 doctor 路由报告需要适配。本手册说明该重新读哪些实时接口、记录下来的期望是什么、该改哪个调用点、以及每个修复怎么验证。
---

# 重新适配 dsh-plugin-balance-pet

Harness 网页界面里的一只常驻余额桌宠。宿主半边负责读余额；浏览器半边负责画桌宠，
并且掌握全部设置面板——也就是桌宠的右键菜单。

**版本 0.4.3。** 本包与其他 bundle 不共享任何代码，所以升级只会影响
`compat/expected-surface.json` 里列出的那些接口面。

## 收到任何问题报告时的第一步

```powershell
curl.exe -s http://127.0.0.1:19387/dsh-plugin-balance-pet/doctor
```

按这个顺序读：

| 字段 | 含义 |
|---|---|
| `version` | **先拿它和 `package.json` 比对。** 插件的宿主半边不会热加载，所以版本过旧时，其他每个字段都是在描述**旧代码**。 |
| `ok` / `requiredFailures` | 有必需的宿主接口不见了。那个列表就是待办清单。 |
| `checks[]` | 每个接口及其 `level`（`required` / `fallback` / `optional` / `info`）和 `detail`。 |
| `reading` | 最后一次余额，含 `source`、`error`、`sourceMode`、`apiKeyStored`。 |
| `client` | 浏览器半边最后一次自报：`art`、`appearance`、`expression`、`sizeMode`、`side`、`sprite`、`menuOpen`，以及已经播放过多少步扣费动画。`null` 表示还没有页面轮询过。 |

从 `client` 做初步判断：

| 现象 | 怎么读 |
|---|---|
| 页面开着，`client: null` | 浏览器半边根本没跑起来——检查槽位注册和浏览器控制台。 |
| `client.sprite: false` | 素材加载失败。几乎总是**宿主与浏览器的素材文件名不一致**（见下），不是绘制 bug。 |
| `client.sprite: true` 但看不见东西 | 定位或层级问题；`client.left/bottom/width/height` 会告诉你它以为自己在哪里。 |
| `reading.ok: false` | 余额查询失败，不是绘制失败。看 `reading.error` 和 `reading.sourceMode`。 |

## 素材文件名这个坑

`GET …/asset?file=` 把请求的文件名与**宿主**代码里的白名单（`src/index.js` 的 `ASSET_FILES`）比对；
而**浏览器**半边决定要请求哪些名字（`src/client.js` 的 `EXPRESSIONS`、`APPEARANCES`、`BOWL_FILE`）。
所以改名或替换素材需要**两个文件同时改**——而且因为宿主半边只在重启时重新加载，
**改名正是那种「在重启之前一直显示灰色方块」的改动**。
`tools/verify-live.ps1` 里有一条针对它的检查；另有一条单测断言白名单与磁盘上的文件完全一致。

## 各个接口面

### 1. `ctx.get('deepseekAccount').getBalance(client)` —— 宿主，必需

```js
ctx.get('deepseekAccount').getBalance({ version, locale, timezoneOffsetSeconds })
// => null | { status: 'ready', value: AccountWallet[], bonusWallets: AccountWallet[] }
//         | { status: 'failed' }
// AccountWallet = { currency: 'CNY' | 'USD', balance: string }
```

用 `cordis_inspect_query { platform: 'host', provider: 'Service', method: 'listService',
input: { service: 'deepseekAccount' } }` 重新读它。如果它变了，**只**改 `src/index.js` 里的
`readBalance()`，并保持以下不变式——它们才是这个数字可信的原因：

- `null` 表示**未登录**；`auto` 模式下退到 Key，`account` 模式下如实报告。**绝不能报成 ¥0。**
- `status: 'failed'` 在 `auto` 模式下必须**如实报告**，不能被悄悄换成一个 Key 的余额：
  存了授权时账号余额才是真相，偷偷换掉会和 DSH 自己的账号页面对不上。
- `apikey` 模式**绝不能调用这个接口**（有一条单测和实时脚本各断言一次）。
- 把 `value` **和** `bonusWallets` 都加起来，只算人民币。格式异常的 wallet 会让整次读数失败
  （`sumCnyCents` → `null`），而不是少报。
- **绝不用 `Number` 算分。** `decimalToCents` 在数字串内部移动小数点并用 `BigInt` 四舍五入；
  有一条测试钉住 `0.1 + 0.2 === 30`。

### 2. `ctx.get('webServer').register({kind: 'exact', path, handler})` —— 宿主，必需

用 `{ service: 'webServer' }` 查。有两个性质都至关重要、都不可让步：

- **只按 pathname 匹配**（`dsh-host-webserver` 匹配的是 `new URL(req.url).pathname`）。
  如果将来的版本改成匹配整条 URL，`/state` 上的 `?interval=`、`?source=`、`?report=` 就会坏掉；
  修法是把它们挪进 `POST` 请求体。
- **handler 收到的是原始 `node:http` 的 request/response**，并且不区分方法——这正是同一条
  `/apikey` 路由能同时服务 `POST` 和 `DELETE` 的原因。如果某个版本把请求包了一层，
  就需要同步更新 `readQuery` / `readJsonBody` / `sendJson`。

### 3. `shell.overlay` —— 浏览器，必需，现在有三个占用者

```
cordis_inspect_query { platform: 'client', provider: 'Slots', method: 'listSubTree',
                       input: { root: 'shell.overlay' } }
```

注册为 `balance-pet`（900，画布）、`balance-pet.menu`（901）、`balance-pet.dialog`（902）。
三者都在同一个点击穿透的图层里。

**必须保住那套输入模型。** 桌宠保持 `pointer-events: none`，并在对素材做过 alpha 测试之后
在 `window` 的**捕获**阶段抢输入；菜单面板和对话框遮罩则用 `pointer-events: auto` 重新接管。
把桌宠容器改成 `pointer-events: auto`，会让素材的透明边角吞掉本该落到下面应用上的点击——
这是本插件最容易犯、也最烦人的一种退化。

如果这个槽位消失了，**不要**退回到 `document.body`：插件永远不该往 body 上追加第二个应用。
换一个同样横跨整个框架的列表槽位，并接受位置不同。

### 4. `settings.section` —— 刻意不使用

右键菜单就是设置面板。有一条测试断言字符串 `settings.section` 不会再出现在 bundle 里。
如果哪天又想要一个设置页，那是设计变更——先重新读这个槽位的契约
（`label` 是 `string | () => string`，owner props 是 `{ close }`）。

### 5. `sidebar.footer.action` —— 浏览器，桌宠隐藏时必需

「设置」旁边那个把隐藏的桌宠叫回来的入口，owner props 是 `{ wide }`（`false` = 56px 窄轨）。
从 0.4.0 起它是**唯一**的退路，并且只在桌宠隐藏时渲染——两个开关互斥。

这让这个槽位承担了新的责任：一旦它不再可用，隐藏了桌宠的用户就没有可见的退路。
插件针对这一点做了防护，而不是假设槽位一定正常：入口挂载时会设置 `pet.sidebarReady`，
在它被设置之前，菜单里的 **隐藏桌宠** 是 `disabled` 的。如果将来的 DSH 改了这个槽位的契约，
**修那个组件——不要删掉这个防护**。清除 `hidden` 的控制台一行命令在包的 README 里。

## 不允许漂移的行为

每一条都有会大声失败的测试：

| 性质 | 位置 | 测试 |
|---|---|---|
| 每分钱一步，每 0.2 秒一次提示，不漂移 | `modelTick` | "the beat holds at 0.2 s per step with no drift" |
| 超过 400 分的变动直接对齐，而不是播几分钟 | `modelApply` | "exactly 400 cents still animates; 401 aligns immediately" |
| 重复轮询不会重播已经播过的钱 | `modelApply` | "a repeated poll never replays money already animated" |
| 充值立刻显示，金额来自**两次服务器读数** | `modelApply` | "the credit is measured from server readings, never from the lagging display" |
| 被唤醒的标签页不会一次爆出一串 | `modelTick`（增量上限 0.1 秒） | "one long frame (a woken tab) fires at most one step" |
| 红闪、震动、`-0.01` 是仅有的反应 | `renderPet` | "the drop animation really is the only animated reaction left" |
| 扣费中**以及结束后 1 秒内**都用痛苦表情 | `resolveArt` / `modelPained` | "the pained face is held for exactly one second after the run ends" |
| 没有读数时蓝色大肥鱼借用抱盆姿势 | `resolveArt` | "resolveArt: 蓝色大肥鱼 falls back to the bowl pose with no reading" |
| 隐藏与显示互斥，且没有死路 | `buildSidebarAction` + `sidebarReady` 防护 | "hiding and showing are mutually exclusive: never two controls at once" |

要手工测试扣费动画，走 `/refresh` 并让余额真的变化。客户端侧的「排练」正是测试套件存在的意义所在。

**不要让扣费动画在「来源变化」时触发。** 切换 `余额来源` 改变的是数字**来自哪个账号**，
两者之间的差额不是消费。浏览器半边正是在那次刷新前把 `firstReading` 置为 `true`。

## 那些数字在哪里

| 常量 | 值 | 含义 |
|---|---|---|
| `STEP_INTERVAL` | 0.2 秒 | 每步一分钱 |
| `HIT_DURATION` | 0.55 秒 | 震动 + 红闪的时长 |
| `FLOAT_LIFETIME` | 0.95 秒 | `-0.01` 飘多久 |
| `TOPUP_DURATION` | 0.9 秒 | 到账后的绿色圆环 |
| `MAX_PENDING_STEPS` | 400 | 超过它就对齐而不是播动画 |
| `FLOAT_BAND` | 0.55 | 顶部留给飘字的区域；永不接受输入 |
| `CUSTOM_MIN` / `CUSTOM_MAX` | 60 / 420 | `自定义` 尺寸对话框的范围 |
| `TABLET_WIDTH` / `TABLET_HEIGHT` | 400 × 220 | 映射到实测平板四边形上的虚拟面板 |
| `FACE_HAPPY` / `FACE_PAIN` | `'11'` / `'22'` | 充值瞬间和扣费时自动使用的表情 |
| `PAIN_HOLD` | 1.0 秒 | 最后一分钱落地后 `紧张` 还要保持多久 |

`LAYOUT` 跟随每张素材自己的宽高比：盒子是素材本身加上 `0.09 · side` 的震动余量，
所以 1:1 的素材会得到一个更窄的盒子，而不是被拉伸。改了那个余量就要同步更新几何测试。

`src/client.js` 里的 `ART_DEEPSEEK` / `ART_WIDE` / `ART_WIDE_GEMINI` 是素材的名义尺寸
加上**从左上角量起的平板四边形**。每次替换素材都要用
`python tools/render-pet-preview.py --corners` 重新量——它会把四边形画回每张源图上，
比凭感觉猜快得多。

## 验证一次改动

```powershell
# 1. 模型、金额运算、来源模式、路由——不需要 DSH
node test\balance-pet.test.mjs

# 2. 桌宠和菜单长什么样（和浏览器 canvas 同一套运算）
python tools\render-pet-preview.py

# 3. 实时接口、版本是否最新、各项守卫、两种来源模式
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-live.ps1
```

然后**重启 DSH 再相信结果**：插件的宿主半边不会热加载，而实时脚本的第一条检查就是为了抓你忘记重启。
浏览器半边会自己重新加载（改完 `src/client.js` 刷新页面即可）。

`src/index.js` 里的 `VERSION` 和 `package.json` 里的 `version` 要一起改，并同步更新
`compat/expected-surface.json`。

如果你改动了用户能看到的东西，**说清楚哪些部分你验证过、哪些没有**：
安装成功和槽位注册只证明这个 bundle **跑起来了**，不证明桌宠看起来是对的。
