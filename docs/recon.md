# dsh-Go 原生面板 recon（task-1）

> 给 ui 实现「API 余额」面板用的**事实清单**：字段名、代码形状、上限、出处。
> 基准：公开仓库 `ccch1mneyyy/dsh-Go`，main @ `efa70c152128dfdc03e17441f3b4848ed41fbffe`（2026-11-13 08:31 +0800）。
> 本机 `/root/.dsh/skills/dsh-go-plugin/kit/` 的检查器与仓库 `sdk/plugin-kit/` 当前完全一致（`lib/testing.js`、`schema/view.schema.json` 的 md5 相同），所以本机 `check.mjs` 的结论对得上。
> 取数方式：`git clone --depth 1 --filter=blob:none --sparse` 只取 `docs examples/plugins sdk`（23 MB），App 端 Dart 解析器用 `gh api` 单文件取；没有整仓 clone。

## 出处约定

仓库文件路径均指 GitHub 仓库内路径；行号对应当前 main。GitHub URL 前缀：
`https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/`

| 简称 | 仓库路径 | 说明 |
|---|---|---|
| `inputs.md` | `docs/plugins/inputs.md` | v2 输入、表单、绑定、校验、并发（**表单权威文档**） |
| `actions.md` | `docs/plugins/actions.md` | 效果白名单、点按、延后效果 |
| `components.md` | `docs/plugins/components.md` | 组件目录、上限、选项与确认 |
| `styles.md` | `docs/plugins/styles.md` | v2 accent/文字/容器样式 |
| `versions.md` | `docs/plugins/versions.md` | 三个版本号、降级、adaptView |
| `slots.md` | `docs/plugins/slots.md` | 插槽、panel placement、strip |
| `design-rules.md` | `docs/plugins/design-rules.md` | 不能自定义什么、性能、署名 |
| `preview.md` | `docs/plugins/preview.md` | 本地 Flutter 预览工具 |
| `checklist.md` | `docs/plugins/checklist.md` | 自查清单（含隐私与安全） |
| `protocol.md` | `docs/design/native-plugins-protocol.md` | NA 协议：panel/data/invoke/patch/pending 上限 |
| `views.md` | `docs/design/native-plugins-views.md` | 视图规格：绑定、点按、v2 预算、容错 |
| `view.schema.json` | `sdk/plugin-kit/schema/view.schema.json` | 机器可读字段/上限 |
| `testing.js` | `sdk/plugin-kit/lib/testing.js` | SDK 测试宿主（桥接逻辑的替身） |
| `limits.js` | `sdk/plugin-kit/lib/bridge/limits.js` | 协议常量（计时/字节/次数） |
| `caps.js` | `sdk/plugin-kit/lib/caps.js` | `hasComponent` / `adaptView` |
| `sdk README` | `sdk/plugin-kit/README.md` | SDK 不发布 npm、测试宿主用法 |
| `workbench/view.js` `workbench/index.js` | `examples/plugins/dsh-go-example-workbench/lib/` | v2 表单/tabs 的完整可跑示例 |
| `usage/view.js` | `examples/plugins/dsh-go-example-usage/lib/view.js` | 面板绑定 + list 绑数据 + strip 示例 |
| `dsh_ui_bind.dart` | `app/lib/ui/chat/dsh_ui/dsh_ui_bind.dart` | App 绑定求值实现 |
| `dsh_ui_plugin_model.dart` | `app/lib/ui/chat/dsh_ui/dsh_ui_plugin_model.dart` | App 组件解析实现（list/action 就在这里） |
| `dsh_ui_plugin_controls_model.dart` | `app/lib/ui/chat/dsh_ui/dsh_ui_plugin_controls_model.dart` | App v2 控件上限 |
| `dsh_ui_plugin.dart` | `app/lib/ui/chat/dsh_ui/dsh_ui_plugin.dart` | 视图入口/缓存 |
| `changelog.md` | `docs/changelog.md` | App 各版本引入的功能 |

### 逐条出处（task-1 的 1–9 条 ↔ GitHub URL）

| # | 主题 | 主要出处（完整 GitHub URL） |
|---|---|---|
| 1 | form 提交/onChange/输入限制 | [docs/plugins/inputs.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/inputs.md)、[examples/.../workbench/lib/index.js](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/examples/plugins/dsh-go-example-workbench/lib/index.js) |
| 2 | list 行逐行动态参数 | [dsh_ui_bind.dart](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/app/lib/ui/chat/dsh_ui/dsh_ui_bind.dart)、[dsh_ui_plugin_model.dart](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/app/lib/ui/chat/dsh_ui/dsh_ui_plugin_model.dart)、[examples/.../toolbox/lib/index.js](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/examples/plugins/dsh-go-example-toolbox/lib/index.js) |
| 3 | options/confirm/pending/patch | [docs/plugins/actions.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/actions.md)、[docs/design/native-plugins-protocol.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/design/native-plugins-protocol.md) |
| 4 | v2 结构/样式 | [docs/plugins/components.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/components.md)、[docs/plugins/styles.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/styles.md)、[sdk/plugin-kit/schema/view.schema.json](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/sdk/plugin-kit/schema/view.schema.json) |
| 5 | 版本/minApp/降级 | [docs/plugins/versions.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/versions.md)、[docs/changelog.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/changelog.md)、[sdk/plugin-kit/lib/caps.js](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/sdk/plugin-kit/lib/caps.js) |
| 6 | data/feed 生命周期 | [docs/design/native-plugins-protocol.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/design/native-plugins-protocol.md)、[sdk/plugin-kit/lib/bridge/limits.js](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/sdk/plugin-kit/lib/bridge/limits.js) |
| 7 | testing host / 测试建议 | [sdk/plugin-kit/lib/testing.js](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/sdk/plugin-kit/lib/testing.js)、[sdk/plugin-kit/README.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/sdk/plugin-kit/README.md)、[sdk/plugin-kit/package.json](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/sdk/plugin-kit/package.json) |
| 8 | preview 能否在本机跑 | [docs/plugins/preview.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/preview.md) |
| 9 | 打码密钥的安全规则 | [docs/plugins/checklist.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/checklist.md)、[docs/plugins/inputs.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/inputs.md)、[docs/plugins/actions.md](https://github.com/ccch1mneyyy/dsh-Go/blob/efa70c152128dfdc03e17441f3b4848ed41fbffe/docs/plugins/actions.md) |

### 存疑 / 未确认（不要当既成事实）

- **视图 `v: 2` 根标志的精确引入版本未确认**：changelog 0.9.5 只说加入了输入/表单/tabs 和样式；`v:2` 字段本身何时上线没有单独写。判断能力请用 `caps.components`（App 实际发来的名单），不要硬编码版本。
- **panel 按钮的 pending 未在真机单独验证**：机制与胶囊/菜单共用同一 invoke 通道（见 §3.3），代码层面成立。
- **「list 行数据里带 action」没有官方示例**：App 解析代码路径支持（§2.2），官方只演示了 view 函数里生成逐行 action（toolbox）和纯展示绑定（usage）。
- **打码密钥与文档「视图里不显示密钥」的措辞差异**：见 §9.3，需 Lead 拍板。
- **App 端 `options` 组件上限 8 是读 App 源码得到的**（`DshUiLimits.options = 8`），`components.md` 也写 8；文档 `views.md` 的「每字段 24 个」指 v2 `select` 输入的选项，不是 `options` 组件，别混。

---

## 0. 结论速览（先看这 10 条）

1. **表单提交**：`form.submit` 的 handler 收到 `event.value = { values: { 'data.form.<字段>': 值, … } }`，key 就是**写进视图的 `bind` 字符串原样**（不是字段名）。只读字段不进 `values`。
2. **onChange**：`event.value = { bind: 'data.form.x', value: <新值> }`；250ms 合并；`onChange` 的请求 `userGesture=false`，**返回值只接受 `patch` / `refresh`**（不能 toast/copy 等）。
3. **list 行可以带逐行动态参数**，两种已验证写法：(a) 把整个 `list.items` 绑定到 `data.rows`，每行数据里直接带 `action: { id: 'select', args: { id: 'p_1' } }`（**推荐**，行多也不占视图字节）；(b) `action` / `action.args` 本身可写绑定，但整块 args 只能取一个对象。行点按 `event.action='select'`、`event.value={ id:'p_1' }`。
4. **`options` 组件最多 8 项**（App 硬上限），而 spec 允许 24 家服务且 `data.options` 是选择列表 → **spec §7 的「选择服务 options」在 >8 家时不成立**，改用 list 行内 action（见 §2）。
5. `confirm` 是**内嵌的一对确认/取消按钮**，不是弹窗；点按 → `event.value={confirmed}`，handler 自己按 `confirmed` 分支。
6. **panel actions 里可以用延后效果**（pending），不限于 `on(id)`：handler 返回 `{pending:{label,timeoutMs}, result:(signal)=>…}`，结果只能 `insert/copy/toast/patch`，每插件同时 ≤2 个，`patch` 缺省目标就是发起面板。
7. **patch 是 RFC 7386 JSON Merge Patch**：`null` 删除、数组整体替换、对象深合并，≤16 KiB；同时并进 App 当前数据和桥接数据源；下一次 `emit` 仍是整份覆盖。数据里 `null` 等同缺失，App 绑定取不到画「—」。
8. **v2 根节点写 `v: 2`**；清单 `dshGo.v` 仍然是 `1`。组件 `type` 用公开名（`tabs`/`badge`/`codeBlock`/`divider`/`spacer`/`emptyState`/`gallery`），**不要**写 schema 内部定义名（`sectionsV2` 等）。
9. **App 版本**：输入/表单/tabs/折叠等是 **0.9.5**（2026-10-27）加入；emptyState/gallery/环形进度/trend/`accent:"app"` 是 **0.9.8**（2026-10-29）。`minApp` 可选、文档建议「不写」；正确做法是用 `caps.components` 判断并给 v1 回退（`adaptView`）。
10. **本机不能跑 preview**：需要完整源码 + Flutter（仓库指定版本）+ App 字体，本机 `flutter` 不存在；只能 `check.mjs` + 真机。SDK `@dsh-go/plugin-kit` **未发布 npm**（`private:true`），但本机 skill kit 里有一份，测试可引用。

---

## 1. 表单与输入（`form` / `textField` 等）

### 1.1 最小表单与提交形状（精确）

`inputs.md:5-31`（另见 `workbench/view.js`、`workbench/index.js`）：

```js
{
  v: 2, type: 'form', submit: 'save', submitLabel: '保存',
  children: [
    { type: 'textField', label: '名称', bind: 'data.form.name',
      required: true, minLength: 2, maxLength: 80 },
    { type: 'number', label: '单价', bind: 'data.form.price', min: 0, max: 10000 },
    { type: 'stepper', label: '数量', bind: 'data.form.count', min: 1, max: 20 },
  ]
}
```

用户提交时，`save` handler 的 `event`：

```js
// event.surface = 'panel'
// event.id      = 'balance'（面板 id）
// event.action  = 'save'    （form.submit 的动作 id）
// event.value   = { values: { 'data.form.name': '新值', 'data.form.count': 2, ... } }
```

- key 是 **bind 路径原样字符串**；`workbench/index.js:50-55` 就是这么读的：`values['data.form.name']`、`values['data.form.count']`。
- `values` 只含**可编辑、有 `bind` 的后代字段**；`readOnly: true` 的字段不提交，宿主应从自己状态取（`inputs.md:89`）。
- `submit` 也可以写 `{ id, args }`；动态值（`bind`/`value`/`values`）覆盖同名静态 args（`inputs.md:77`）。
- 整个 `event.value` **≤ 4 KiB UTF-8 JSON**（含静态 args）；超限 App 保留草稿、就地报错，不截断发送（`inputs.md:77`、`views.md:178`）。
- 提交时 App 冻结这次值快照、取消本表单未发送的 onChange、禁用提交按钮直到 invoke 返回；单个面板同一时刻只有一个在途 invoke（`inputs.md:91-95`）。
- 校验失败不 invoke；失败保留草稿并显示「未保存，请重试」（`inputs.md:95,103`）。
- 表单**不能嵌套**；`tabs`/`collapsible` 可以放进表单，**隐藏的字段同样参与校验和预算**（`inputs.md:81-89`）；提交收集的是表单里所有可编辑、有 `bind` 的后代字段（`inputs.md:89`），因此隐藏页签里的字段不会自动免除提交。

### 1.2 onChange 形状

| 触发 | handler 的 `event.value` | 出处 |
|---|---|---|
| `onChange: 'changed'` | `{ bind: 'data.form.name', value: '新值' }` | `inputs.md:72-75` |
| `form.submit: 'save'` | `{ values: { 'data.form.name': '新值', 'data.form.count': 2 } }` | `inputs.md:72-75` |

- `onChange` 在该字段停止变化 **250ms** 后发送；同一面板的变化共享最多每 250ms 一次的发送窗口（`inputs.md:93`）。
- `onChange` 请求的 `userGesture` **始终为 false**：只接受 `patch` / `refresh`，不授予 toast/copy/open/link/command 等手势效果（`inputs.md:97`）。
- 程序性 `patch` 或 `emit` **不会触发** `onChange`（`inputs.md:103`）。
- 需要「选模板后立刻刷新字段」这类联动时：onChange handler 里更新插件状态，返回 `{ patch: {...} }`；**不要**指望在 onChange 里 toast。

### 1.3 输入组件字段限制（App 侧，不只是 schema）

`inputs.md:35-70`、`views.md:165-180`、`view.schema.json` 的 `inputV2`：

| 组件 | 关键字段 | 值/限制 |
|---|---|---|
| `textField` | `label`（必填、非空）、`bind`、`value`、`readOnly`、`placeholder`、`required`、`minLength`、`maxLength`、`multiline`、`maxLines` | 字符串；`maxLength` 缺省 256 个 Unicode 标量、**最多 2000**；单行缺省；多行缺省 4 行、最多 8 行 |
| `number` | `min`、`max` | 可编辑数字；输入中允许暂时为空/未完成小数；提交转有限数值；空的可选值提交 `null`；缺省范围 −10⁹..10⁹；显式边界绝对值 ≤10¹² |
| `stepper` | `min`、`max`、`step` | 加减调整；`step` 缺省 1、最小 10⁻⁹；`max` 必须 > `min` |
| `toggle` | — | 布尔；`false` 是有效值 |
| `slider` | `min`、`max`、`step`、`range` | 缺省 0–100/步长 1；区间值 `[start,end]`；步长须把区间等分 1–1000 份，否则降级为占位 |
| `select` | `options`、`placeholder` | 下拉单选，值为字符串；`options` **≤24** 项，字符串或 `{label,value}`；`value` 非空、≤200 字、唯一 |
| `segmented` | `options` | 单选，同上 |
| `chips` | `options`、`multi` | 单选字符串；`multi:true` → 字符串数组 |
| `date` | `minDate`、`maxDate` | `YYYY-MM-DD`；1900–2100，按真实日历校验 |
| `time` | — | 24 小时制 `HH:mm`，不含时区 |
| `rating` | `max` | 0 到 max 整数；max 缺省 5，限制 1–10 |
| `form` | `children`（必填）、`submit`（必填）、`label`、`submitLabel` | 不能嵌套；`label` ≤200、`submitLabel` ≤80（schema）；`submit` 见 1.1 |

- 每个输入必须有**非空 `label`**；省略 `bind` 的输入只读，可用 `value` 显示固定值；`bind` 存在时它读的数据优先于字面 `value`（`inputs.md:37`）。
- 每视图 **≤32 个输入/字段**（`views.md:167`、`DshUiControlLimits.fields = 32`）。
- App 校验：`required`（空字符串/空数组/`null` 失败，数字 0 和布尔 false 有效）、`min/max`（有限数/区间端点）、`minLength/maxLength`（Unicode 标量数）、`pattern` 只接受 `email|integer|decimal|alphanumeric|slug`、select/segmented/chips 值必须在 options 里（`inputs.md:79-89`）。
- **没有密码组件**：不接受 `password`、`obscureText` 或密码键盘；输入内容仍属于插件，别让用户填系统凭据（`inputs.md:62`）。

### 1.4 可写路径（`bind`）语法

`inputs.md:68-70`、`view.schema.json` `inputV2.bind`：

- 必须以 `data.` 开头；后面 1–16 个字段段；每段 `[A-Za-z_][A-Za-z0-9_-]{0,63}`；总长 ≤256。
- **不允许数组下标**、空段、`__proto__`/`prototype`/`constructor`。
- 同一视图不能重复绑定一个字段，也不能同时绑定父对象和子字段。
- 只读绑定 `{"$":"data.a.b"}` 宽松些：允许 `data.rows[0].name` 这种数组下标（≤16 段）。

### 1.5 对 spec 表单的直接影响（坑，务必看）

spec §7 的表单字段 ↔ App 限制对照：

| spec 字段 | spec 上限 | 可用控件 | 实际可输入上限 / 注意 |
|---|---|---|---|
| `name` | 1–24 字 | textField | `maxLength: 24` |
| `url` | ≤2048 字符 | textField | **textField 最多 2000 标量** → 视图里 `maxLength: 2000`；core 校验仍可按 spec 2048 接受文件里的值 |
| `secret` | ≤2048 | textField | 只能普通文本框（**无密码框**，输入可见）；`maxLength` ≤2000；placeholder「已保存，留空不改」 |
| `secretHeader`/`secretParam` | ≤64 | textField | `maxLength: 64` |
| `username` | ≤128 | textField | `maxLength: 128` |
| `loginUrl` | ≤2048 | textField | >2000 的部分输不进去，`maxLength: 2000` |
| `tokenPath`/`tokenHeader`/`tokenPrefix` | 默认值，未给上限 | textField | 建议 `maxLength: 200` / 32 |
| `headersText`/`bodyText` | ≤4096 | textField `multiline: true` | **单字段最多 2000**，视图里最多 8 行；且整个提交 ≤4 KiB（见下） |
| `balancePath`/`currencyPath` | 路径 ≤256 | textField | `maxLength: 256` |
| `detailPaths` | ≤6 项，label 1–20 | textField multiline（每行 `标签=路径`） | 不能绑数组下标，所以只能整段文本；`maxLength` 建议 ≤1000 |
| `method`/`authType`/`preset` | 枚举 | select | 值用字符串；`authType` 6 个选项 OK（≤24） |
| `divisor`/`multiplier` | 1e-6..1e12 | number | `min: 0.000001, max: 1e12` |
| `decimals` | 0–4 整数 | stepper | `min:0, max:4, step:1` 最稳 |
| `symbol` | ≤8，可空 | textField | `maxLength: 8` |
| `enabled`/`stripEnabled` 等 | bool | toggle | 表单里若要放开关用 toggle |
| `preset` 联动 | — | select + onChange 或 actions | 见 1.2 |

**4 KiB 提交预算（硬上限）**：`event.value` 是**整张表单一次性**提交，不是逐字段。spec 表单约 20 个字段，若 `url`(2000)+`secret`(2000)+`headersText`(2000)+`bodyText`(2000)+`detailPaths` 同时填满，会 >4 KiB → App 直接报「超限」不 invoke。建议在视图里把长文本字段的 `maxLength` 压到安全值（例如 url 400、secret 300、headersText 800、bodyText 800、detailPaths 600，合计仍 <3 KiB），core 校验依旧按 spec 接受外部文件写入的长值。
> 如果 ui 想保留 spec 的 2048/4096 上限，需要把表单拆成「基本信息 / 鉴权 / 高级」多个**并列的 form**（不能嵌套，但 tabs 的每个 children 里各放一个 form 合法）——这偏离 spec 的「一个 form + 一个 save」契约，先问 Lead。

**另一个实现选择**：表单是否显示、错误 callout 是否显示，取决于插件状态而非数据。`view(scope, caps)` 可以闭包读插件状态（它是注册时创建的函数），结构变化后调 `ctx.dshGo.refresh('balance')` 让 App 重新 GET 视图（`protocol.md:161-163`：`refresh(id, scope?)` → 给订阅连接发 `stale`）。否则 App 会一直用旧视图结构。

---

## 2. list 行的逐行动态参数

### 2.1 结论

**可以**。而且推荐「把行数据整体绑定」，这样每行自己带 action 和参数，行数再多也不占视图 JSON 预算。

### 2.2 推荐写法 A：`list.items` 绑定到 `data.rows`，行内带 action

视图只写绑定（`views.md:97`：任何属性值、数组元素乃至整个 children 数组都能绑定）：

```js
{ type: 'list', items: { $: 'data.rows' } }
```

`panelData` 推出（每次都是新对象）：

```js
{
  rows: [
    {
      title: 'DeepSeek',
      subtitle: '成功 · 09:12',
      trailing: '¥12.34',
      tone: 'good',
      action: { id: 'select', args: { id: 'p_abc123' } },  // 每行不同
    },
    { title: 'new-api 中转', subtitle: '失败 · 09:12', trailing: '—', tone: 'bad',
      action: { id: 'select', args: { id: 'p_def456' } } },
  ],
}
```

行点按后 handler 收到（`actions.md:51`、`views.md:121-127`）：

```js
select: (_scope, event) => {
  // event.action === 'select'
  // event.value === { id: 'p_abc123' }   ← 就是该行 action.args
  ...
}
```

**证据 / 置信度**：
- `dsh-go-example-usage/lib/view.js:60` 有 `{ type: 'list', items: { $: 'data.models' } }`，证明「整个 items 绑数据」是官方示例用法；
- `dsh-go-example-toolbox/lib/index.js:40` 有逐行不同 args 的 `list`：`items: TEMPLATES.map(t => ({ title, action: { id:'use', args:{id:t.id} } }))`，证明逐行 args 是设计内用法；
- 「行数据里携带 action 也能被解析」是从 App 解析器代码路径确认的（见下），**没有找到直接把 action 放在 data 里的官方示例**；真机专项验证建议放进 ui 的验收。

**为什么这是对的（App 实现依据）**：
- `dsh_ui_plugin_model.dart:791` 先对整棵视图模板做 `resolveDshUiBindings(template, data, view: true)`，把 `items` 的绑定换成 `data.rows` 的值；
- 然后 `_list()`（`dsh_ui_plugin_model.dart:350-391`）逐行读 `item['action']`，交给 `_pluginAction()`（同文件 `:298-321`）解析成 `{id,args}`；
- `dsh_ui_bind.dart:99-101` 明确：「Bound values are inserted as they are: data is never searched for bindings」→ 行数据里的 action 必须是**普通 JSON**（里面不能再套 `{"$":...}`）。

数据里的 `action.args` 在 App 里会做 ≤1 KiB、深度 16 的检查（`dsh_ui_plugin_model.dart:310-320`）。

### 2.3 写法 B：`action` / `action.args` 自身写绑定

schema 允许（`view.schema.json` `$defs/action`：`args` 可以是 object 或 binding；`action` 本身也可以是 binding）：

```js
// 整块 args 从一个对象取（适合"当前选中服务"这种共享参数，不适合逐行不同值）
{ type: 'actions', items: [
  { label: '编辑', action: { id: 'edit', args: { $: 'data.selectedArgs' } } },
] }
```

- 绑定会被求值成 data 里的值；若取到的不是对象，`_pluginAction` 判定非法，该元素不可点。
- 逐行不同参数**不能**靠这个（一行只有一个静态 action，除非写在行数据里 → 回到写法 A）。

### 2.4 写法 C：`options` 选中 + 再操作（spec 现在的写法）及其上限

`options` 组件（`components.md:86`、`views.md:57-60`）：

```js
{ type: 'options', id: 'select', options: { $: 'data.options' }, selected: { $: 'data.selectedId' } }
```

- 点按 → invoke `id='select'`，`event.value = { value }`；`multi:true` 时是 `{ values }`（`views.md:123-124`）。
- 点下后 App 先按选中画，invoke 失败退回；**最终选中态以插件推来的 `selected` 为准**（`views.md:132`、`actions.md:57`）→ handler 里必须自己更新 `selectedId` 并 push（emit/patch）。
- **`options` 组件上限 8 项**（`components.md:86`；App 里 `DshUiLimits.options = 8`，见 `dsh_ui_model.dart:35`）。而 spec 允许 24 家服务 → >8 家时 `options` 会截断/不能全选。
- v1 的 `options` 组件给的是 `{value}`，而 v2 `select` 输入组件是 `form` 字段（值直接进草稿），两者不要混。

**推荐**：服务列表用 `list` + 每行 action（写法 A）作为主入口；`options` 省略，或只在服务 ≤8 家时保留（spec 的 `data.options` 保留给 ui 的判断）。这样 spec §7 第 4 条「选择服务 options」需要改。

---

## 3. options / confirm / deferred / patch

### 3.1 options

见 §2.4。补充：
- `options` 项的 `value` 不写时，回传/选中用 `label`（`views.md:60`）。
- 选项数组可直接写字符串或 `{label, description?, value?}`（`components.md:86`）。
- 工具卡里 `options` 只读（面板不受影响）。

### 3.2 confirm（不是弹窗）

`components.md:87`、`views.md:58`：

```js
{ type: 'confirm', id: 'delete', confirmLabel: '删除', cancelLabel: '取消' }
```

- 渲染成**一对按钮**（确认 / 取消），点任一 → invoke `id='delete'`，`event.value = { confirmed: true | false }`。
- `confirmLabel`/`cancelLabel` ≤12 字。
- **没有「点按钮→弹确认框」的组件**。要做「删除前确认」：先由 `delete` 动作把 `data.confirmDelete=true`（patch）→ 视图里出现 `confirm` 组件 → 用户点确认 → 再删。结构是否出现仍靠 `refresh`（见 1.5 末尾）。

### 3.3 延后效果（pending）在 panel actions 里可用

依据（代码层面确认）：
- `actions.md:64-101` 的延后效果是通用 handler 规则，没限定 surface；
- `protocol.md:190-199`：handler 立即返回 `{pending, result}`，`result` 只能用 `insert/copy/toast/patch`，§4.7 全文没有按 surface 区分；
- SDK 测试宿主（桥接自己的逻辑）`testing.js:252-297` `startPending` 在 `invoke()` 里对**任意 handler** 生效，包括 `panel(id).actions[action]`（`testing.js:325-360`：先查 `actions` 表，`splitPending(result)` 再走 pending）。

> 未在真机单独验证「panel 按钮的 pending」；但它和胶囊/菜单走同一条 invoke 通道、同一份桥接代码，风险低。ui 的「刷新」「测试」按这条写即可。

推荐写法（spec §7 的 refresh/test 就照这个）：

```js
ctx.dshGo.panel('balance', {
  view,
  data,
  actions: {
    refresh: (_scope, _event) => ({
      pending: { label: '正在刷新', timeoutMs: 30000 },
      result: async (signal) => {
        const results = await queryAll(enabled, { signal })
        if (signal.aborted) return {}                 // 取消：不执行任何效果
        await saveResults(...)
        return [{ type: 'patch', data: { busy: false, rows: ..., total: ... } },
                { type: 'toast', text: `已更新 ${results.length} 家` }]
      },
    }),
  },
})
```

规则（`protocol.md:458-481`、`actions.md:64-101`）：

| 项 | 值 |
|---|---|
| `pending` | `true` 或 `{ label?, timeoutMs? }`；`label` ≤16 字 |
| `timeoutMs` | 1000–60000，缺省 30000；超界夹到边界；到点 → `void timeout`，`signal` 触发 |
| `result` | Promise，或 `(signal) => 值/Promise`；值可写效果对象/数组/简写 |
| 结果里允许的效果 | **只有 `insert` / `copy` / `toast` / `patch`**；`open`/`link`/`command`/`refresh` 必须当场返回 |
| 每插件同时 | ≤2 个未兑现；第 3 个 429 `too-many-pending` |
| 只兑现一次 | 完成/超时/取消/断线先到先算，后到丢弃 |
| `patch` 目标 | 缺省 = 发起点按的面板（`protocol.md:480,494`） |
| 出错 | `result` 抛错 → 本次作废（`void error`），不执行效果；**过期和出错不算违规** |
| 首个 pending 回执 | 必须仍在该次点按的 3 秒窗口内到达，之后结果可晚到（`inputs.md:97`） |

### 3.4 立即效果与 3 秒窗口

- 一次 ≤4 个效果（`protocol.md:497`）。
- App 从用户点按算起 **3 秒内**收到的效果才执行，迟到静默丢弃；桥接 handler 超时也是 3 秒（`actions.md:60-62`、`protocol.md:426-427`）。
- 简写对象多键会按键顺序展开：`{ copy: md, toast: '已复制' }`（`actions.md:36-40`）。

### 3.5 patch 合并语义（RFC 7386）

`protocol.md:378-381,494-497`、`actions.md:27`：

- `{type:'patch', data, id?}`：`data` 是 **JSON Merge Patch 对象**，≤16 KiB；对象深合并；`null` 表示删除；**数组整体替换**（不会逐项合并）。
- App 立即把 patch 合并进该面板当前数据并重绘；桥接同时并入该 `{pkg,id,scope}` 的数据源（若在跑），其他订阅者经流收到。
- 下一次插件 `emit` 仍是**整份**数据模型，桥接自己算差量。
- 数据里的 `null` 等同缺失（App 绑定取不到都画「—」），数组整体替换（`protocol.md:378-381`）。
- 插件侧**不要原地改**上一条 emit 的对象；App 解析缓存按 `view`/`data` 对象身份做键，数据变了要传**新 Map**（`dsh_ui_plugin.dart:100`、`views.md:338`）。

---

## 4. 视图 v2：结构组件与样式

### 4.1 根节点与 accent

`styles.md:1-24,62-85`：

```js
{
  v: 2,
  accent: 'teal',                    // 或 'app' / '#3D6F9C'；根节点、仅 v2
  type: 'stack',
  style: { card: 'surface', padding: 'L', gap: 'M' },
  children: [ ... ],
}
```

- `accent` 可写：`'app'`（跟随用户在 App 里选的主题色）、10 个命名色（`red orange amber green teal blue indigo violet pink gray`）或 `#RRGGBB`；其他颜色位置可写 `'accent'` 引用它。
- 颜色名称区分大小写；App 会按实际背景自动校正文字对比度（校正只是提示，不会让视图失败）。
- 老 App 不认 `accent:"app"`，按默认蓝色画；不认 v2 样式就仍画 `text`/`value`。
- 默认主题色蓝色；`check` 用 `#4B67B4` 预演。

### 4.2 容器样式（`stack`/`row` 的 `style`）

`styles.md:87-126`、`view.schema.json` `layoutStyle`：

| 属性 | 可写值 | 说明 |
|---|---|---|
| `card` | `plain` / `surface` / `tinted` / `outlined` | 普通 / 升一档底色 / 主题色浅底 / 主题色描边 |
| `background` | 命名色、`accent`、`#RRGGBB` | 固定浅底，优先于卡片默认底色 |
| `padding` | `S`/`M`/`L` = 8/12/16 dp | 窄处四边一起缩 |
| `gap` | `S`/`M`/`L` | 根容器缺省 L，嵌套缺省 M |
| `align` | `start`/`center`/`end` | stack 横向 / row 纵向 |
| `columns` | `equal` 或 1–8 个整数权重（每个 1–12） | row 用；窄屏自动减列 |
| `dividers` | 布尔 | stack 项间横线 / row 列间竖线 |

**不接受**任意尺寸、圆角、定位、层叠、透明度、渐变、动画参数（`design-rules.md:5-20`、`styles.md:120-126`）。

### 4.3 文字样式与 spans

`styles.md:26-60`：

```js
{ type: 'text', text: '余额 ¥12.34',
  style: { size: 'title', weight: 'bold', color: 'accent', align: 'start', maxLines: 2 } }
```

| 属性 | 可写值 |
|---|---|
| `size` | `display`(28) / `title`(24) / `subtitle`(20) / `body`(16) / `caption`(13) / `mono`(14)；缺省 body，metric 数值 title |
| `weight` | `regular`(400) / `medium`(500) / `semibold`(600) / `bold`(700) |
| `italic`/`underline`/`strike` | 布尔 |
| `align` | `start`/`center`/`end` |
| `maxLines` | 1–20 |
| `color` | 命名色 / `accent` / `#RRGGBB` |

- `text`、`metric`、`callout` 接受 `style`；metric 的 style 只作用于数值。
- 行内 spans（`styles.md:52-60`）：`spans: [{text, color?, weight?, mono?, background?}]`；**节点 `text` 仍必填**（旧 App / 状态条 / 复制摘要的回退）；每段 ≤32 个 span，面板整树 ≤256；span 不是组件、不带动作；URL/链接在 span 里会被忽略。

### 4.4 结构/展示组件：公开 `type` ↔ schema 内部定义名（别写错）

映射来自 `view.schema.json` `$defs/node.allOf`：

| 视图里写 | schema 定义 | 关键字段 / 上限 | 出处 |
|---|---|---|---|
| `tabs` | `sectionsV2` | `items: [{label, children}]`；**8 个页签**；本地切换、不发 invoke；隐藏页签的后代仍计入预算；标签页里的表单字段仍参与校验/提交 | `inputs.md:111`、`views.md:167`、`dsh_ui_plugin_controls_model.dart:39` |
| `collapsible` | `containerV2` | `label?`、`children`、`expanded?` | `inputs.md:112` |
| `accordion` | `sectionsV2` | `items: [{label, children}]`、`expanded?`；**8 组**，`expanded` 初始打开第一组 | `inputs.md:113` |
| `carousel` | `sectionsV2` | `items: [{label, children}]`；**8 页**，上一页/下一页，不自动轮播 | `inputs.md:114` |
| `timeline` | `sectionsV2` | `items: [{label, children}]`；**24 项** | `inputs.md:116` |
| `grid` | `containerV2` | `children`、`columns?` 1–4（缺省 2）；自适应窄屏 | `inputs.md:115` |
| `badge` / `tag` | `badgeV2` | `text` ≤200、`tone?`；展示用不 invoke | `inputs.md:117` |
| `avatar` | `image` | `src`、`alt?`；48dp 方形，沿用 image 资源/像素限制 | `inputs.md:118` |
| `codeBlock` | `codeV2` | `code` ≤8000 **UTF-16 单元**、`language?` ≤32；最多 240dp 高，可滚动/复制，不执行脚本 | `inputs.md:119` |
| `divider` | `spaceV2` | 无字段 | `inputs.md:120` |
| `spacer` | `spaceV2` | `size: 'S'|'M'|'L'` = 8/16/24dp，不接受任意值 | `inputs.md:121` |
| `emptyState` | `emptyStateV2` | `title` ≤40、`message?` ≤120、`icon?`、`action?: {label ≤12, action, icon?}`（至多一个按钮）；面板里才有按钮 | `components.md:59`、`inputs.md:142` |
| `gallery` | `galleryV2` | `items: [{src, alt?, caption? ≤40, action?}]`；`columns?` 2–4、`aspect?` 0.5–2；面板 **≤24 张**；`src` 同 image（`asset:` 或 ≤64 KiB `data:`） | `components.md:60` |

v2 组件的 `type` 枚举在 `view.schema.json` 的 `$defs/node.properties.type`；**清单里不存在 `sectionsV2`/`containerV2`/`badgeV2` 这些 type**，写它们会得到「未知组件」灰色占位。

### 4.5 v1 组件（回退 / 面板主体）

`components.md:12-46,86-87`：`stack`、`row`、`text`、`metric`、`chart`、`compare`、`steps`、`callout`、`options`、`confirm`、`list`、`keyValue`、`progress`、`table`、`actions`、`image`。

- `list` ≤50 行、`keyValue` ≤24 项、`table` ≤8 列/50 行、`actions` ≤4 个（至多一个 primary）、`options` ≤8。
- `metric` 数字 1 万以上自动千分位；`table` 数值列自动右对齐；`callout` tone `info/good/warn/bad`；`text` tone 只有 `muted`。
- 色调用 `good/warn/bad/info/muted`，别名 `success/warning/danger/error/note/secondary` 也认；具体颜色由 App 定。
- **图标**：162 个（`components.md:123`），含 `wallet`、`refresh`、`add`、`edit`、`delete`、`play`、`chart`、`coin`、`money` 等；**没有锁/钥匙/盾牌**这类安全语义图标。不认识画默认图标。
- 图片：`asset:<路径>`（清单 `dshGo.assets`）或 `data:image/{png,jpeg,webp,gif};base64,…` ≤64 KiB；单边 ≤4096、总像素 ≤400 万（`components.md:47-48`）。
- v2 的 `actions`/`confirm` 用插件描边按钮；`style:"primary"` 在 v2 会降级并记诊断（`styles.md:115`）→ **v2 下别写 primary**。

### 4.6 面板建议骨架（API 余额，ui 可照抄方向）

```js
const b = (p) => ({ $: `data.${p}` })

{
  v: 2,
  type: 'stack',
  accent: 'app',                     // 跟随用户主题；旧 App 按默认蓝
  style: { gap: 'M' },
  children: [
    { type: 'metric', label: '总余额', value: b('total.text'), caption: b('total.caption') },
    { type: 'actions', items: [
      { label: '刷新', icon: 'refresh', action: 'refresh' },
      { label: '添加服务', icon: 'add', action: 'add' },
    ]},
    { type: 'list', items: b('rows') },                        // 行内带 action（§2）
    ...(state.form
      ? [{ type: 'tabs', items: [
            { label: '基本信息', children: [ /* form 或 textField */ ] },
            { label: '鉴权', children: [ ... ] },
            { label: '字段与显示', children: [ ... ] },
          ]}]
      : []),
    ...(state.test ? [{ type: 'codeBlock', language: 'json', code: b('test.raw') }] : []),
  ],
}
```

注意：
- 结构里带条件（form/test/confirm）时，视图函数闭包读插件状态，状态变后调 `ctx.dshGo.refresh('balance')`。
- `list`/`options`/`keyValue` 绑定到数据；视图里不放大数组（32 KiB 上限）。
- 表单可以整个放进 `tabs` 的一个页签，也可以每个页签一个 form（避免 4 KiB 一次提交；见 §1.5）。

### 4.7 面板预算

`components.md:128-136`、`protocol.md:319-341,511-530`：

| 项 | 面板上限 |
|---|---|
| 视图 JSON | 32 KiB（桥接卡；超过 500 `invalid-view`，计违规） |
| 节点数 / 层数 | 120 / 8（App 截断并标注；桥接只报 `stats`） |
| 每个 `stack`/`row` 直接孩子 | 32 |
| 文字 / 标签 | 2000 / 200 字（标签类属性还会被 App 各自裁剪，如 list title 200） |
| 动作 args | 求值后 ≤1 KiB，深度 16 |
| 数据整份 / patch | 32 KiB / 16 KiB |
| `invoke.value` / `event.value` | 4 KiB（表单提交、options 选中都在内） |

---

## 5. 版本、minApp 与旧 App 降级

### 5.1 三个版本号（`versions.md:5-11`）

| 版本 | 在哪 | 现在 |
|---|---|---|
| 协议 `v` | 清单 `dshGo.v` | `1`（**不要改**） |
| 视图格式 `v` | 视图根节点 `v`（可选） | `1` / `2` 并存；省略 = 1 |
| App 版本 `minApp` | 清单 `dshGo.minApp` | 可选；文档建议**不写** |

- 根节点写 `v: 2` 才启用样式和新组件；NA 信封/清单仍 `v: 1`（`versions.md:29`）。
- 未知视图版本按 v1 处理并记诊断。

### 5.2 minApp

- `minApp` 格式 `"x.y.z"`（`manifest.schema.json` semver）。App 低于它 → `state: "needs-app"`，原生部分**不显示**、退回网页岛（`protocol.md:65,258,540`）。
- 不写 `minApp` 时，App 缺 `app` 参数按 `"0.0.0"`，不触发 needs-app（`protocol.md:212`）。
- spec 现在没写 `minApp`。**建议保持不写**：用 `caps.components` 决定 v2/ v1，老 App 至少能看只读摘要；写了 `minApp` 会让老 App 直接看不到面板。
- 若 ui 认为表单是核心、老 App 无法编辑不如不显示，可以写 `"minApp": "0.9.5"`，但这会把降级策略从「只读」变成「整体不显示」——先和 Lead 确认。

### 5.3 实际引入版本（changelog 证据）

`changelog.md`：

- **0.9.5**（2026-10-27，`changelog.md:640`）：插件原生界面支持更丰富的文字样式与配色，以及**输入框、滑块、开关、下拉、日期、评分、表单、页签、折叠**等控件；选文件/图片；本地插件一键重载。
- **0.9.8**（2026-10-29，`changelog.md:557`）：插件视图新增**空状态、图片墙、环形进度、指标趋势**，跟随用户配色，图标扩到 162 个。
- 1.0.9（`changelog.md:261`）：插件技能/清单按 view v2 更新（文档层）。
- 1.0.13（`changelog.md:105`，「插件开发：插件省略能力参数时按 v1 的默认处理，不再当成空列表」）：缺 caps 时按 v1。

> 注：以上是从 changelog 反推的**功能引入版本**，不是 `caps` 协商的精确版本号。判断能力请以 `caps.components`（App 实际发来的组件名列表）为准，不要硬编码 App 版本。

### 5.4 caps 与 adaptView（旧 App 降级）

视图函数签名 `(scope, caps) => 视图`；caps（`protocol.md:172`、`tests` defaultCaps）：

```js
{
  protocol: 1,
  app: '1.0.13',                    // 或 "0.0.0"
  locale: 'zh-CN',
  surfaces: ['composer.actions', 'message.actions', 'composer.strip', 'panels', ...],
  components: ['stack','row','text',..., 'textField','form','tabs', ...],  // App 能画的组件名单
}
```

- `caps.components` 不含某组件 → **不要**用它；缺 caps 按 v1 处理（`inputs.md:148`、`versions.md:31`）。
- SDK 工具（`caps.js`）：`hasComponent(caps, 'textField')`、`hasSurface(caps,'...')`、`appAtLeast(caps,'0.9.5')`、`localize(caps,{zh,en})`、`adaptView(view, caps, fallbacks?)`。
- 老 App 行为（`versions.md:17-33`、`views.md:186-200`）：
  - 不认识的组件 → **单个灰色占位**，其余照画；
  - 根节点坏 / 整棵树只剩未知组件 → 整块「插件界面有误」；
  - 不认识的属性/style/accent/spans → 忽略，继续画 `text`/`value`；
  - 需要数组的组件拿到空数组/取不到 → 「暂无数据」；
  - 绑定取不到 → 「—」。
- `adaptView` 只在 `!hasComponent(caps, type)` 时替换（`caps.js`）：`textField` 等输入 → `text`（`label: —`）；`form`/`tabs`/`accordion`/`carousel`/`timeline`/`collapsible`/`grid` 展开成 `stack` 子节点；`badge`/`tag`/`codeBlock` → `text`；`divider`/`spacer`/`avatar` → 删掉；`emptyState` → `callout` + 可选按钮；`gallery` → `grid` 里 `image`（没有 grid 就竖排）。`actions`/`image`/`list` 等 v1 组件在旧 App 的能力表里本来就有，不会被替换（`hasComponent` 为真）。
- 因此：**保留 v1 需要的 `text`/`value` 内容**，v2 根节点不要只放新控件；老 App 的 fallback 最好在视图函数里按 `hasComponent` 直接返回 v1 摘要（spec 可接受只读）。
- 清单 `dshGo.v` 仍写 `1`；`package.json` 现在的清单已经正确，不要动。

---

## 6. panel data 函数与 feed 生命周期

### 6.1 注册签名

`protocol.md:161-174`：

```js
ctx.dshGo.panel('balance', {
  view: (scope, caps) => 视图,                 // 或直接对象；3 秒超时，抛错 500
  data: (scope, emit, caps) => 取消函数 | void | Promise<取消函数>,
  actions: { refresh: (scope, event) => … },   // 视图里按钮/行/options/confirm 的处理器
})
```

- `data` 收到 `scope = { sessionId? }`（panel 在 `session.tab`/`chat.panel` 带；`features` 为空）和 `caps = { protocol, locale }`（**没有 components**）。
- `emit(data)` 推**完整**数据模型（JSON 对象或 `null`）；桥接算差量、限频、限大小；**取消后再调 emit 无效**。
- 数据函数返回的取消函数在数据源停止时调用；异步数据函数（返回 Promise<cancel>）若在 stop 后才 resolve，桥接仍会执行清理（`testing.js:456-459`）。
- `data` 可以不存在（面板只读/静态），但那样 GET 的 `live=false`，没有订阅流。
- 本插件的注册 id 必须和 `package.json` 的清单一致：面板 `panel('balance', …)`、状态条 `strip('balance-strip', …)`（清单里 `composer.strip[0].id = "balance-strip"`、`panels[0].id = "balance"`；改 id 要同时改清单，别只改代码）。
- `strip` 用 `ctx.dshGo.strip(id, (scope, emit, caps) => cancel)`，数据形状是 `{ text, icon?, tone? }`，不是组件树（`protocol.md:433-446`）。`strip` 的清单项写了 `panel: "balance"` → 用户点状态条会直接打开该面板，不会 invoke `on(id)`（`slots.md:9`）。

### 6.2 首次数据、rev、流

`protocol.md:319-345,348-381`：

- App 打开面板先 `GET /dsh-go/v1/views/<pkg>/<id>?…`；桥接启动（或复用）该 `{pkg, id, 规范化 scope, locale}` 的数据源，**最多等 1 秒第一份 `emit`**：
  - 1 秒内有 emit → 响应带 `data` 和 `rev`；
  - 没有 → `data: null`、`rev: null`，`live: true`，App 继续订阅流等后续数据。
- 响应还带 `stats: {bytes,nodes,depth}` 给 App 截断用；视图来源优先级 `panel(id).view` > 清单静态 `view` 文件。
- 数据源按 **locale 分开**（不区分大小写，`_` 视同 `-`）。GET 视图和流 `hello` 必须带同一个 locale，订阅才能接上同一份 feed。
- App 用 `sub {sub, pkg, id, scope?, rev?}` 订阅；桥接回 `data`（整份）/ `patch`（RFC 7386，`base` + `merge`）/ `sync`（App 的 rev 已最新）。
- App 的 rev 对不上 → 重发 `sub` 带自己的 rev 补拉整份；`rev` 不透明、只比较相等；数据源重建后旧 rev 必然不等 → 收整份。
- `stale` = 视图变了（插件调 `refresh`），App 重新 GET 视图，订阅保持。
- `end` 原因：`not-found` / `degraded` / `not-native` / `limit` / `error`。

### 6.3 取消、linger 与限额

`protocol.md:343,511-530`、`limits.js:35-40`：

| 项 | 值 |
|---|---|
| 最后一个订阅者离开后 | 数据源**保留 30 秒**再取消（`feedLingerMs: 30000`） |
| 数据源总数 | 全局 64 个，满时先回收闲置的 |
| `emit` 频率 | 每个数据源 ≤4 Hz：250ms 内多次 emit 只发最后一份 |
| 整份数据 | ≤32 KiB；超 → 丢弃这次 emit，计违规，App 保留旧数据 |
| 补丁 | ≤16 KiB 发 patch，否则发整份 |
| 心跳 | 桥接 WebSocket ping 每 25s；60s 没收到任何帧判掉线 |
| App 重连 | 退避 1/2/4/8/16/30s；重发 hello + 全部 sub（带 rev）= 补拉 |
| 插件降级 | 连续 5 次违规 → `state:"degraded"`、取消全部数据源、推 `end degraded`；之后视图/invoke 409 `degraded`，直到重载/重启 |

- 数据函数抛错、`emit` 非对象/不可序列化/超 32 KiB → 计违规（`protocol.md:505`）。
- 插件卸载/停用/热重载 → 注册自动撤销，数据源取消（`protocol.md:155`）。

### 6.4 对本插件的数据设计建议

- **首帧只读缓存**：`data()` 第一次同步 `emit(cachedResults)`（不联网），然后按 spec 后台刷新；不要在 `data()` 里直接 await 网络（GET 等 1 秒，首帧会空）。
- 缓存没有结果时 emit `{ busy: true, total: {...caption:'更新中…'} … }`；刷新完再 emit 一次（4 Hz 限频，别高频 emit）。
- **状态条数据函数只读缓存、绝不联网**：strip 在输入框上方常驻，订阅周期和面板不同；用缓存数据拼 `{ text, icon:'wallet' }`（≤24 字；空串/null 表示不显示）。
- `data()` 返回取消函数：清定时器/AbortController；`signal.aborted` 或取消后不再 emit。
- locale：数据函数只有 `caps.locale`，英文/中文文案在 `emit` 时按 locale 选；面板数据最好语言无关（数字为主），`words()` 在视图函数里取（视图函数有完整 caps.locale）。
- `refresh` 动作里更新数据后必须重新 `emit`（或返回 patch），并调用 `ctx.dshGo.refresh('balance')` 只用于**视图结构**变化，不要拿它代替数据推送。

---

## 7. SDK testing host 能不能用

### 7.1 结论：能用，但不是 npm 包

- `@dsh-go/plugin-kit` 的 `package.json`：`"name": "@dsh-go/plugin-kit"`、`"version": "0.1.0"`、**`"private": true`**（`sdk/plugin-kit/package.json`）。
- `sdk README` 明确：「**不发布到 npm**：在仓库里引用，或把需要的文件拷进你的插件。」
- 测试宿主在 `sdk/plugin-kit/lib/testing.js`，零依赖（只 import `node:` 和 `./bridge/*`），Node 22.19+ 可直接跑。
- **本机已有一份**：`/root/.dsh/skills/dsh-go-plugin/kit/lib/testing.js`，与仓库当前 main 的 md5 相同（`bd71126eba06f50a28c364b51552eb40`；`schema/view.schema.json` 也同 md5）。所以在这台机器上可以：
  ```sh
  node --input-type=module -e "import { createTestHost } from '/root/.dsh/skills/dsh-go-plugin/kit/lib/testing.js'; console.log(typeof createTestHost)"
  ```
- 但**测试/CI 不应依赖绝对路径**。三种可行策略见 7.4。

### 7.2 API（`testing.js:72-487`、`sdk README`）

```js
import { createTestHost } from '@dsh-go/plugin-kit/testing'   // 实际按路径 import
import { apply } from '../lib/index.js'

const host = createTestHost({ dir: pluginDir, services: { sessions }, caps: {}, bridge: true })
apply(host.ctx)                                   // 跑你的 apply(ctx)

host.contributions()                              // App 收到的清单行（含 ready/issues）
await host.view('balance', { sessionId: 's1' })   // { view, stats, source }
await host.invoke('balance', { action: 'save', value: { values: { 'data.form.name': 'x' } } })
                                                  // → { effects, issues } 或 { effects:[], pending, settled, cancel }
const feed = host.subscribe('balance', {})        // feed.data / feed.history / feed.errors / feed.stale / feed.settled / feed.stop()
feed.data                                         // 最新一份（null 字段已丢弃；strip 文本会截 24）
host.refresh('balance')                           // 模拟视图 stale
host.emitEvent('session/event', session, event)   // 触发插件 ctx.on
await pendingEntry.settled                        // { t:'done', effects } / { t:'void', reason }
host.pendings                                     // 未兑现的延后结果
host.registrations()                              // { panels, strips, notes, handlers, dataPanels }
host.violations                                   // 桥接会记的违规
host.dispose()
```

- `createTestHost({ bridge: false })` 模拟没有 dsh-go 桥接的主机：`ctx.inject(['dshGo'])` 不执行，用来测「安静加载」。
- 测试宿主**不模拟**：4 Hz 限频、首次数据 1 秒等待、WebSocket 流、`withoutNulls` 之外的 App 渲染。`feed.history` 记录所有 emit，不做节流（`testing.js:408-418`）。
- `checkEffects` / `checkPending` 也导出，可直接断言 handler 返回值的白名单/上限。

### 7.3 测试建议（本项目）

1. **首选：ui 的单测直接测导出的纯函数**（`panelView`、`panelData`、`actions` handlers）。不依赖任何外部路径，符合 spec「零运行时依赖 + `node --test test/*.test.js`」：
   - `panelView` 返回的视图里每个 `{"$":"data.x"}` 路径都能在 `panelData` 输出里找到（spec §9 要求）；
   - handler 用假 `scope/event` 调用，断言返回的效果形状/字段；
   - 用 `node:assert/strict` 检查字节数（Buffer.byteLength(JSON.stringify(view)) ≤32768）、节点数/深度、文案上限。
2. **可选：本地跑 SDK 测试宿主**做一次集成验证（`host.invoke('balance',{action:'save',...})`、`host.subscribe`），但**不要**把它写进 `npm test` 的硬依赖；用 `try { await import(process.env.DSH_GO_KIT ?? '/root/.dsh/skills/dsh-go-plugin/kit/lib/testing.js') }` 之类动态导入并跳过，或只在本地脚本里跑。
3. **CI/可移植方案**：把 `sdk/plugin-kit/lib/testing.js` + `lib/bridge/*.js` + `schema/view.schema.json` + 必需的 `lib/json-schema.js`/`lib/messages.json` 拷到 `test/vendor/`（MIT，保留 LICENSE），从相对路径 import。这是 SDK README 允许的用法（「把需要的文件拷进你的插件」），但会增加仓库文件，需 Lead 同意。
4. 不联网、不写真实 `$DSH_HOME`（spec §9）；测试宿主自带临时环境。

### 7.4 检查器（本机可用，最终验收）

`checklist.md:7-12`、`sdk README`：

```sh
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs .          # 清单 + 静态视图
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load   # 再跑 apply(ctx)，检查注册/视图
```

- 退出码：0 无错误（可有提示）/ 1 有条目不生效 / 2 原生部分整体不显示或视图整块坏 / 3 读不了文件。
- `--load` 在临时 `DSH_HOME` 里加载，不碰真实配置（`sdk README`）。
- `--json` 机器可读；`--lang en` 中英文各量一遍文字上限；`--budget panel|toolCard|strip`；`--app x.y.z` 模拟 App 版本。
- 注意：`--load` 会执行插件的 `apply`；我们的 `apply` 不应在加载时联网/写文件（spec §8），否则检查会有副作用。
- 现在仓库还没有 `lib/index.js`（脚手架 lib/ 为空），`--load` 要等 ui 实现后才有意义；`check.mjs .` 目前只能查清单。

---

## 8. preview 预览工具在这台 Ubuntu 上能不能跑

**结论：不能。** 依据：

- `preview.md:7-11`：需要「**完整 dsh-go 源码**、Node 22.19+、**仓库指定的 Flutter**，以及已经准备好依赖、本地化、App 字体和测试字体的 `app/`」；预览本身跑 `flutter test --no-pub`，缺字体会直接失败。
- 本机实测（2026-11-13）：
  - `node --version` → `v24.22.2`（满足 Node ≥22.19）；
  - `which flutter` → 无输出（**未安装**）；
  - 稀疏 checkout 只有 `docs/ examples/plugins sdk/`，没有 `app/`、没有 Flutter 依赖/字体；
  - 安装 Flutter/全量源码需要装全局包/大下载，超出本次任务授权。
- `preview.md:50` 说已在 Linux、Node 24、Flutter 3.47 验证过，但那是**源码仓库内**的开发工具，不是手机端 skill 的一部分；本机 skill kit 里也没有 preview 入口（`kit/bin` 只有 `check.mjs`）。
- 替代方案：`check.mjs` 查结构与上限 → 装进 App 真机看（Lead 的验收步骤）；ui 单测覆盖绑定路径/预算/文案。若能拿到完整源码 + Flutter 再考虑补跑，本次不做。

---

## 9. 安全规则：把打码后的密钥放进面板数据

### 9.1 文档原文（相关条款）

- `checklist.md:54-60`（隐私与安全）：「**不收集、不外传密钥、令牌、Cookie；视图里不显示它们**」；读到的草稿/剪贴板/消息只用于这一次点按，不落盘。
- `inputs.md:62`：「**没有密码组件**，也不接受 `password`、`obscureText` 或密码键盘类型。输入内容仍属于插件；**请勿让用户在插件里输入系统凭据**。」
- `actions.md:121` / `protocol.md:498`：永不开放「读 App 设置或凭据」、无点按自动触发。
- `design-rules.md:12-20`：审批卡/授权按钮/密码框永远没有；插件不能伪装系统界面。
- `protocol.md:211`：所有 `/dsh-go/*` 路由和 WebSocket 走路由守卫（无凭据 401 / 跨站 403）。
- `native-for-free.md:24-26`（另一条路径，供参考）：插件导出的 Config 里 `role('secret')` 只写不读；密钥要用 `role('credential-ref')`。**我们的插件自己管 config 文件，不走 App 原生设置页**，所以这条不直接用，但说明 App 对「可回显的密钥」是谨慎的。
- 本插件的 spec §8 已规定：secret 只在存储/请求头/内存；**不得**写进 UI 文本/日志/模型；表单不回填真实密钥；面板数据只放 `maskSecret`。

### 9.2 对实现的具体约束

1. **面板数据里的密钥只能打码**：`maskSecret('sk-abcdef123456') → '••••3456'`（spec §2.2）；长度 ≤8 → `'••••'`。除此之外不要放原始 secret、token、Cookie、Basic 密码、请求头全文。
2. **不要让打码值进入其他 surface**：
   - 不放进 `strip` 文本（状态条是常驻一行，`strip` 的 `text` 只放总余额）；
   - 不放进 `toast`/`copy`/`insert`/`link`/`command` 的效果文本（这些会到剪贴板/输入框/日志式位置）；
   - 不放进 `link` URL（链接只收 https，且会显示给用户/浏览器）。
3. **`rawPreview` 清洗**：spec 说只给「测试」时由 patch 短暂显示、≤8192 字符、不含请求头。响应 JSON 可能回显 key（少见但可能有），建议在放入 `rawPreview` 前把与 secret / username / token 完全相同的字符串替换成 `'••••'`；错误文案也不要拼 URL（`authType=query` 时 URL 里有 secret）或请求头。
4. **表单里密钥输入框**：没有密码组件，只能用普通 `textField`（输入可见）；placeholder「已保存，留空不改」，编辑时 `secret:''`、`secretSet:true`；不要把已保存的 secret 回填到 `bind` 的值里（否则 App 本地草稿/视图数据里会出现明文）。
5. **日志**：`ctx.logger` 不打印 secret/header/URL query；错误映射成人话中文（spec §5）。
6. **配置存储**：`$DSH_HOME/cache/dsh-go-api-balance/config.json` 0600、目录 0700、原子写（spec §2）；这只在主机侧，符合文档「凭证留在主机」。
7. **`wants` 不需要**：插件不读剪贴板/草稿/消息，清单不要加 `wants`（`slots.md`、`protocol.md:127-135`）。
8. **无点按不联网**：数据函数在面板打开时跑，可以联网；loading 时不要在插件加载阶段 fetch（`checklist.md:39-40`、spec §8）。

### 9.3 一处需要 Lead 拍板的措辞冲突

- spec §7/§8 要求「面板数据里只放打码」；
- 文档边界 `checklist.md:58` 写的是「视图里**不显示**它们（密钥/令牌/Cookie）」；
- 严格字面理解，连 `••••3456` 也算「密钥的一部分」，不应该出现在视图里；产品上「显示后四位」是常见做法，也符合 spec。
- **建议**：只显示末 4 位（≤8 位时全打码）、绝不出现完整值；并在给 Lead 的摘要里点名这处措辞差异，由 Lead 决定要不要在 README/文档里写明「只显示后四位」。

---

## 10. 与 spec 的冲突 / 风险清单（ui 必须知道）

| # | spec 写法 | 平台事实 | 建议 |
|---|---|---|---|
| 1 | §7 用 `options` 选服务，24 家 | `options` 组件上限 **8 项** | 服务列表用 `list` 行内 action（§2）；options 只在 ≤8 时保留，或删掉 |
| 2 | 表单一个 `save` 提交所有字段 | `event.value` 整张表单 **≤4 KiB**；单 textField ≤2000 标量 | 压短长字段 maxLength；或拆多个并列 form（偏离 spec，先问 Lead） |
| 3 | `url` ≤2048、`headersText/bodyText` ≤4096 | 输入控件最多 2000 字符 | 视图 `maxLength:2000`；core 校验仍按 spec 接受文件值 |
| 4 | 表单字段多、分 tabs 隐藏 | 隐藏字段**同样参与校验/预算**；提交收集表单内所有可编辑、有 `bind` 的后代；同一字段不能重复绑定 | 把必填放显眼位置；别在两个 tab 绑同一字段；提交前 core 再校验 |
| 5 | 删除直接执行 | 没有「按钮弹确认框」；`confirm` 是内嵌按钮对 | 用 `data.confirmDelete` + `confirm` 组件 + `refresh`，或按 spec 直接删（更简单） |
| 6 | 面板结构固定 | 结构不能靠数据条件渲染（绑定取不到只画「—」/「暂无数据」） | 视图函数闭包读插件状态 + `ctx.dshGo.refresh('balance')` 控结构 |
| 7 | `data()` 首帧推缓存 | GET 最多等 **1 秒**首份 emit，否则 `data:null` | 首帧同步 emit 缓存，后台刷新 |
| 8 | 密钥末四位放面板 | 文档写「视图里不显示」密钥 | 只显示 `••••`+末 4；先按 spec，把措辞差异报 Lead |
| 9 | 状态条文案示例 15 字 | `strip.text` ≤**24 字**（超出截断） | 控制文案；空串/null 表示不显示 |
| 10 | 没有 minApp | 文档建议不写；写了老 App 整体不显示 | 不写 minApp，用 `caps.components` 降级 |
| 11 | 超时 30s 的延后效果 | `timeoutMs` 1–60s，缺省 30s；每插件同时 ≤2 个 pending | 正好 30000 可用；避免同时点多个刷新 |
| 12 | patch 到 `data` | patch ≤16 KiB；数据整份 ≤32 KiB；rawPreview 8 KiB + 表单可能超 | 测试 `Buffer.byteLength(JSON.stringify(data))`，必要时缩小 rawPreview/不把大表单与 rawPreview 同帧 emit |
| 13 | 状态条常驻 | strip 数据源在输入框可见时就会跑 | strip 只读 results 缓存，绝不在 strip data 里联网 |
| 14 | 面板放 `session.tab`/`features`/`chat.panel` | scope：`session.tab` 与 `chat.panel` 带 sessionId，`features` 为空；数据源按 scope 分开 | 插件是全局的，data 函数不要依赖 sessionId；strip 同理 |

---

## 11. 给 ui 的最小验收清单

- [ ] 根节点 `v: 2`，清单 `dshGo.v` 仍 `1`，未加 `minApp`；`ctx.inject(['dshGo'], …)`，不是 `'dshGo?'`。
- [ ] `panelView` 用 `caps`/`hasComponent` 决定 v2 或 v1 回退（至少给只读 `text`/`keyValue`/`list` 摘要）。
- [ ] 面板视图 ≤32 KiB / ≤120 节点 / ≤8 层（单测用 JSON 统计）。
- [ ] `panelData` 输出里包含视图所有 `$` 绑定路径（单测遍历视图收集 `$` 并与 data 对比）。
- [ ] 表单 `bind` 全部是 `data.form.<field>`，无重复/父子重叠；提交 handler 从 `event.value.values` 按完整 bind 路径取，再 core 校验。
- [ ] 列表行内 `action:{id:'select',args:{id}}`，`select` handler 从 `event.value.id` 取 id 并 patch `selectedId`。
- [ ] `refresh`/`test` 用 `{pending,result}`，`result` 里只 `patch`/`toast`；`signal.aborted` 时停手。
- [ ] patch 都传新对象；数据里不放 `undefined`（会被丢/视为缺失），数组整体替换。
- [ ] 状态条 `{text ≤24, icon:'wallet'}`，空数据显示 `{text:''}`。
- [ ] 面板数据只放 `maskSecret` 后的密钥；`toast`/`copy`/错误文案不含密钥/完整 URL query。
- [ ] 视图结构变化后 `ctx.dshGo.refresh('balance')`。
- [ ] `node --test test/*.test.js` 全绿；`node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load` 0 error。
