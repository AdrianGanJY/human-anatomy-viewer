/**
 * v2 interface copy — EN + 简体 + 繁體, hand-authored, Chinese FIRST.
 *
 * WHY THIS IS NOT `app/i18n/ui.ts`. That file is the INPUT to `scripts/build-zh.mjs`, which
 * writes `public/i18n/*.json` from a translation cache at deploy time. Adding v2's keys there
 * would (a) touch v1's dictionary pipeline, which this task may not change, and (b) ship every
 * new string as English inside a Chinese interface until a translation pass runs — in a
 * teaching tool whose primary reader's mother tongue is Chinese, that is the wrong default.
 *
 * So v2 carries its own small table. It is a table, not a pipeline: every key exists in all
 * three languages by construction, and a missing one is a TypeScript error rather than a
 * silent fallback. v1's dictionaries are still used for STRUCTURE NAMES (`makeT`) — only the
 * furniture lives here.
 */
import type {Lang} from '../i18n/ui';

type Row = Record<Lang, string>;

export const V2: Record<string, Row> = {
 'app.title':      {en: 'Human Atlas', 'zh-Hans': '人体图谱', 'zh-Hant': '人體圖譜'},
 'entry.loading':  {en: 'Loading this view', 'zh-Hans': '正在载入这个视图', 'zh-Hant': '正在載入這個視圖'},
 // The progress line counts BYTES, and says so. v1's '{p}% · Loading 2,234 pieces' mixes a
 // chunk percentage with a part count, so the number and the noun describe different things.
 'entry.bytes':    {en: '{done} of {total} MB', 'zh-Hans': '{done} / {total} MB', 'zh-Hant': '{done} / {total} MB'},
 'entry.sceneReady': {en: 'This view is ready — the rest of the body is still arriving', 'zh-Hans': '这个视图已就绪 — 其余部位仍在载入', 'zh-Hant': '這個視圖已就緒 — 其餘部位仍在載入'},
 'entry.allReady': {en: 'Whole body loaded', 'zh-Hans': '全身已载入', 'zh-Hant': '全身已載入'},

 'rail.aria':      {en: 'Structures in this view', 'zh-Hans': '这个视图中的结构', 'zh-Hant': '這個視圖中的結構'},
 'rail.more':      {en: '{n} more', 'zh-Hans': '还有 {n} 个', 'zh-Hant': '還有 {n} 個'},
 'rail.focus':     {en: 'Focus {name}', 'zh-Hans': '聚焦{name}', 'zh-Hant': '聚焦{name}'},

 'margin.aria':    {en: 'This view', 'zh-Hans': '本视图', 'zh-Hant': '本視圖'},
 'margin.expand':  {en: 'Expand', 'zh-Hans': '展开', 'zh-Hant': '展開'},
 'margin.collapse':{en: 'Collapse', 'zh-Hans': '收起', 'zh-Hant': '收起'},
 'margin.set':     {en: 'In this view', 'zh-Hans': '本视图包含', 'zh-Hant': '本視圖包含'},
 'margin.pieces':  {en: '{n} pieces', 'zh-Hans': '{n} 个部件', 'zh-Hant': '{n} 個部件'},
 'margin.hideOthers': {en: 'Hide others', 'zh-Hans': '隐藏其他', 'zh-Hant': '隱藏其他'},
 'margin.clear':   {en: 'Clear', 'zh-Hans': '清空', 'zh-Hant': '清空'},
 'margin.reference': {en: 'Atlas reference', 'zh-Hans': '图谱编号', 'zh-Hant': '圖譜編號'},
 'margin.source':  {en: 'Anatomical source', 'zh-Hans': '解剖来源', 'zh-Hant': '解剖來源'},

 'role.primary':   {en: 'Primary', 'zh-Hans': '主结构', 'zh-Hant': '主結構'},
 'role.context':   {en: 'Context', 'zh-Hans': '周边结构', 'zh-Hant': '周邊結構'},
 'role.ghost':     {en: 'Ghost', 'zh-Hans': '参考轮廓', 'zh-Hant': '參考輪廓'},

 'search.open':    {en: 'Find', 'zh-Hans': '查找', 'zh-Hant': '查找'},
 'search.placeholder': {en: 'Heart, femur, hamstring…', 'zh-Hans': '心脏、股骨、腘绳肌…', 'zh-Hant': '心臟、股骨、膕繩肌…'},
 'search.empty':   {en: 'No structures match.', 'zh-Hans': '没有匹配的结构。', 'zh-Hant': '沒有匹配的結構。'},
 'search.close':   {en: 'Close', 'zh-Hans': '关闭', 'zh-Hant': '關閉'},
 'search.add':     {en: 'Add {name}', 'zh-Hans': '加入{name}', 'zh-Hant': '加入{name}'},

 'systems.open':   {en: 'Systems', 'zh-Hans': '系统', 'zh-Hant': '系統'},
 'view.reset':     {en: 'Reset view', 'zh-Hans': '重置视角', 'zh-Hant': '重置視角'},
 'view.three-quarter': {en: 'Three-quarter', 'zh-Hans': '四分之三视角', 'zh-Hant': '四分之三視角'},
 'view.front':     {en: 'Front', 'zh-Hans': '前视', 'zh-Hant': '前視'},
 'view.side':      {en: 'Side', 'zh-Hans': '侧视', 'zh-Hant': '側視'},
 'view.back':      {en: 'Back', 'zh-Hans': '后视', 'zh-Hant': '後視'},

 'stage.exit':     {en: 'Show controls', 'zh-Hans': '显示控件', 'zh-Hant': '顯示控件'},
 // `?probe=1` — the real-device timing lane. It has its own fixed panel as of v2.1a, so it needs
 // a label and a dismiss control of its own rather than inheriting the margin's.
 'probe.aria':     {en: 'Timing probe', 'zh-Hans': '性能测量', 'zh-Hant': '效能測量'},
 'probe.close':    {en: 'Hide the timing probe', 'zh-Hans': '隐藏性能测量', 'zh-Hant': '隱藏效能測量'},
 'lang.aria':      {en: 'Language', 'zh-Hans': '语言', 'zh-Hant': '語言'},
 'error.load':     {en: 'The anatomy could not be loaded.', 'zh-Hans': '无法载入解剖数据。', 'zh-Hant': '無法載入解剖資料。'},
 'error.reload':   {en: 'Reload', 'zh-Hans': '重新载入', 'zh-Hant': '重新載入'},
 // The session-expired surface. Access sessions are 24 h by default, so a mid-load 302 to the
 // login page is NORMAL behaviour, not an edge case (build-plan.md:126).
 'error.session':  {en: 'Session expired — tap to continue', 'zh-Hans': '登录已过期 — 点这里继续', 'zh-Hant': '登入已過期 — 點這裡繼續'},
 'v2.badge':       {en: 'v2', 'zh-Hans': 'v2', 'zh-Hant': 'v2'},

 // ══ L31 v2.1b+c, S0 — THE STUDIO SHELL ═════════════════════════════════════════════════════════
 // Authored from `mock/spec.md` §"Copy table". Every row is real copy in all three languages: the
 // shell is placeholder in its WIRING, never in its words, because a shell full of lorem cannot be
 // reacted to and reacting to it is the entire reason S0 ships before S1.
 //
 // ⚠️ NEW `{n}` ROWS AND THE SINGULAR TABLE. `panel.count` and `tabs.note` interpolate counts. Both
 // are added to `V2_ONE` below where the English singular differs (G7 is ALREADY fixed at
 // copy.ts:90 — this extends it, it does not re-fix it: opus-plan-review-2.md RC13). The rest of the
 // count-bearing rows here — `panel.inventory`, `search.results`, `refusal.*` — carry FIXED numbers
 // from the atlas manifest rather than placeholders, so they have no `{n}` at all.

 // ── the app bar ────────────────────────────────────────────────────────────────────────────────
 'studio.title':   {en: 'The studio shell', 'zh-Hans': '工作室界面', 'zh-Hant': '工作室介面'},
 'studio.skip':    {en: 'Skip to the model', 'zh-Hans': '跳到模型区域', 'zh-Hant': '跳到模型區域'},
 'settings.open':  {en: 'Settings', 'zh-Hans': '设置', 'zh-Hant': '設定'},
 'status.ready':   {en: 'Scene ready · {mb} MB · {n} chunks', 'zh-Hans': '场景就绪 · {mb} MB · {n} 个分块', 'zh-Hant': '場景就緒 · {mb} MB · {n} 個分塊'},
 'status.all':     {en: 'Whole body loaded · {n} chunks', 'zh-Hans': '全身已载入 · {n} 个分块', 'zh-Hant': '全身已載入 · {n} 個分塊'},
 'status.autoCollapsed': {en: 'Panels collapsed to protect the field', 'zh-Hans': '已收起面板以保留模型区域', 'zh-Hant': '已收起面板以保留模型區域'},
 'status.empty':   {en: 'Nothing selected', 'zh-Hans': '尚未选择结构', 'zh-Hant': '尚未選擇結構'},
 'status.emptyHint': {en: 'Use Find or tap a structure in the field.', 'zh-Hans': '使用查找，或轻点模型中的结构。', 'zh-Hant': '使用查找，或輕點模型中的結構。'},

 // ── the tools row ──────────────────────────────────────────────────────────────────────────────
 'panel.layers':   {en: 'Layers', 'zh-Hans': '图层', 'zh-Hant': '圖層'},
 'panel.selection': {en: 'Selection', 'zh-Hans': '所选结构', 'zh-Hant': '所選結構'},
 'panel.info':     {en: 'Info', 'zh-Hans': '信息', 'zh-Hant': '資訊'},
 'panel.json':     {en: 'Scene JSON', 'zh-Hans': '场景 JSON', 'zh-Hant': '場景 JSON'},
 'panel.ask':      {en: 'Ask', 'zh-Hans': '提问', 'zh-Hant': '提問'},
 'panel.panels':   {en: 'Panels', 'zh-Hans': '面板', 'zh-Hant': '面板'},
 'panel.close':    {en: 'Close {name}', 'zh-Hans': '关闭{name}', 'zh-Hant': '關閉{name}'},
 'panel.filter':   {en: 'Filter systems or structures…', 'zh-Hans': '筛选系统或结构…', 'zh-Hant': '篩選系統或結構…'},
 'panel.inventory': {en: '15 systems · 3,432 structures', 'zh-Hans': '15 个系统 · 3,432 个结构', 'zh-Hant': '15 個系統 · 3,432 個結構'},
 'panel.meshes':   {en: '2,234 unique meshes', 'zh-Hans': '2,234 个独立网格', 'zh-Hant': '2,234 個獨立網格'},
 // "5 structures · 17 pieces" is TWO independently-pluralised counts, and `v2t`'s singular branch
 // keys on a single `{n}`. Rather than widen that mechanism for one row, the line is COMPOSED from
 // two rows that each own one count — and `margin.pieces` already has its singular (G7). One rule,
 // reused, instead of a second rule that would then need its own audit.
 'panel.structures': {en: '{n} structures', 'zh-Hans': '{n} 个结构', 'zh-Hant': '{n} 個結構'},
 'panel.membership': {en: 'Tick = in this view', 'zh-Hans': '勾选 = 加入本视图', 'zh-Hant': '勾選 = 加入本視圖'},
 'panel.visibility': {en: 'Eye = visibility, this session only', 'zh-Hans': '眼睛 = 可见性，仅本次会话', 'zh-Hant': '眼睛 = 可見性，僅本次工作階段'},
 'panel.resetVisibility': {en: 'Reset visibility', 'zh-Hans': '重置可见性', 'zh-Hant': '重設可見性'},
 'panel.opacity':  {en: 'Opacity', 'zh-Hans': '不透明度', 'zh-Hant': '不透明度'},
 'panel.focus':    {en: 'Focus', 'zh-Hans': '聚焦', 'zh-Hant': '聚焦'},
 'panel.collapse': {en: 'Collapse the sidebar', 'zh-Hans': '收起侧栏', 'zh-Hant': '收起側欄'},
 'panel.expand':   {en: 'Expand the sidebar', 'zh-Hans': '展开侧栏', 'zh-Hant': '展開側欄'},

 'nav.orbit':      {en: 'Orbit', 'zh-Hans': '旋转', 'zh-Hant': '旋轉'},
 'nav.pan':        {en: 'Pan', 'zh-Hans': '平移', 'zh-Hant': '平移'},
 'nav.fit':        {en: 'Fit selection', 'zh-Hans': '适配所选', 'zh-Hant': '適配所選'},
 'nav.home':       {en: 'Home', 'zh-Hans': '全身视图', 'zh-Hant': '全身視圖'},
 'nav.snapshot':   {en: 'Snapshot', 'zh-Hans': '截图', 'zh-Hant': '截圖'},
 'nav.link':       {en: 'Copy link', 'zh-Hans': '复制链接', 'zh-Hant': '複製連結'},
 'nav.plate':      {en: 'Share plate', 'zh-Hans': '分享图版', 'zh-Hant': '分享圖版'},
 'nav.keys':       {en: 'Keys', 'zh-Hans': '按键', 'zh-Hant': '按鍵'},
 'nav.controls':   {en: 'Navigation', 'zh-Hans': '视角导航', 'zh-Hant': '視角導覽'},
 'nav.more':       {en: 'More', 'zh-Hans': '更多', 'zh-Hant': '更多'},
 'nav.stage':      {en: 'Presentation', 'zh-Hans': '展示模式', 'zh-Hant': '展示模式'},
 'nav.keypad':     {en: 'On-screen key pad', 'zh-Hans': '屏幕按键板', 'zh-Hant': '螢幕按鍵板'},
 'nav.hint':       {en: 'Drag to orbit · Shift-click to add · Ctrl K to find · ? for keys', 'zh-Hans': '拖动旋转 · Shift 点击加入 · Ctrl K 查找 · ? 查看快捷键', 'zh-Hant': '拖曳旋轉 · Shift 點擊加入 · Ctrl K 查找 · ? 查看快捷鍵'},
 'nav.touch':      {en: 'One finger: orbit · Two fingers: pan · Pinch: zoom', 'zh-Hans': '单指旋转 · 双指平移 · 捏合缩放', 'zh-Hant': '單指旋轉 · 雙指平移 · 捏合縮放'},
 'nav.modes':      {en: 'Orbit / Pan mode', 'zh-Hans': '旋转／平移模式', 'zh-Hant': '旋轉／平移模式'},
 'nav.views':      {en: 'Named views', 'zh-Hans': '预设视角', 'zh-Hant': '預設視角'},
 'nav.info':       {en: 'About this view', 'zh-Hans': '关于这个视图', 'zh-Hant': '關於這個視圖'},

 'view.this':      {en: 'This view', 'zh-Hans': '当前视图', 'zh-Hant': '目前視圖'},
 'legend.inView':  {en: 'In this view', 'zh-Hans': '本视图中', 'zh-Hant': '本視圖中'},
 'legend.pieces':  {en: 'Pieces', 'zh-Hans': '部件', 'zh-Hant': '部件'},
 'info.reference': {en: 'Atlas reference', 'zh-Hans': '图谱编号', 'zh-Hant': '圖譜編號'},
 'info.included':  {en: 'Included structures', 'zh-Hans': '所含结构', 'zh-Hant': '所含結構'},
 'info.systemNote': {en: 'System description', 'zh-Hans': '系统说明', 'zh-Hant': '系統說明'},

 'json.read':      {en: 'Current scene · read-only until Edit', 'zh-Hans': '当前场景 · 编辑前为只读', 'zh-Hant': '目前場景 · 編輯前為唯讀'},
 'json.copy':      {en: 'Copy JSON', 'zh-Hans': '复制 JSON', 'zh-Hant': '複製 JSON'},
 'json.edit':      {en: 'Edit', 'zh-Hans': '编辑', 'zh-Hant': '編輯'},
 'json.limit':     {en: 'Maximum: 24 structures · 1,400 encoded characters', 'zh-Hans': '上限：24 个结构 · 编码后 1,400 个字符', 'zh-Hant': '上限：24 個結構 · 編碼後 1,400 個字元'},
 'json.none':      {en: 'This view has no scene. Open a shared link, or snapshot the current selection.', 'zh-Hans': '当前视图没有场景。请打开分享链接，或将当前所选保存为快照。', 'zh-Hant': '目前視圖沒有場景。請開啟分享連結，或將目前所選儲存為快照。'},

 'ask.lead':       {en: 'Take this view into your conversation', 'zh-Hans': '把这个视图带入对话', 'zh-Hant': '把這個視圖帶入對話'},
 'ask.note':       {en: 'Ask opens ChatGPT with your prompt and scene link. No answer is generated here. Live Ask arrives with the Realtime path.', 'zh-Hans': '提问将在 ChatGPT 中打开问题和场景链接。这里不生成回答。实时提问随 Realtime 功能提供。', 'zh-Hant': '提問將在 ChatGPT 中開啟問題和場景連結。這裡不產生回答。即時提問隨 Realtime 功能提供。'},
 'ask.placeholder': {en: 'How do these hamstrings move the pelvis in a forward fold?', 'zh-Hans': '这些腘绳肌在前屈时如何带动骨盆？', 'zh-Hant': '這些膕繩肌在前屈時如何帶動骨盆？'},
 'ask.open':       {en: 'Ask in ChatGPT ↗', 'zh-Hans': '在 ChatGPT 中提问 ↗', 'zh-Hant': '在 ChatGPT 中提問 ↗'},
 'ask.context':    {en: 'Included: {n} structures and this scene link', 'zh-Hans': '包含：{n} 个结构和当前场景链接', 'zh-Hant': '包含：{n} 個結構與目前場景連結'},

 'tabs.short':     {en: 'Scenes', 'zh-Hans': '场景', 'zh-Hant': '場景'},
 'tabs.snapshot':  {en: 'Snapshot as a new tab', 'zh-Hans': '快照为新标签页', 'zh-Hant': '快照為新分頁'},
 'tabs.current':   {en: 'Current scene', 'zh-Hans': '当前场景', 'zh-Hant': '目前場景'},

 // ── Settings ───────────────────────────────────────────────────────────────────────────────────
 'settings.title':   {en: 'Settings', 'zh-Hans': '设置', 'zh-Hant': '設定'},
 'settings.general': {en: 'General', 'zh-Hans': '常规', 'zh-Hant': '一般'},
 'settings.language': {en: 'Language', 'zh-Hans': '语言', 'zh-Hant': '語言'},
 'settings.about':   {en: 'About', 'zh-Hans': '关于', 'zh-Hant': '關於'},
 'settings.close':   {en: 'Close', 'zh-Hans': '关闭', 'zh-Hant': '關閉'},
 'settings.ground':  {en: 'Scene background', 'zh-Hans': '场景背景', 'zh-Hant': '場景背景'},
 'settings.groundNote': {en: 'Light by default. An explicit scene background takes precedence.', 'zh-Hans': '默认为浅色；场景指定的背景优先。', 'zh-Hant': '預設為淺色；場景指定的背景優先。'},
 'settings.light':   {en: 'Light', 'zh-Hans': '浅色', 'zh-Hant': '淺色'},
 'settings.dark':    {en: 'Dark', 'zh-Hans': '深色', 'zh-Hant': '深色'},
 'settings.keypad':  {en: 'On-screen key pad', 'zh-Hans': '屏幕按键板', 'zh-Hant': '螢幕按鍵板'},
 'settings.off':     {en: 'Off', 'zh-Hans': '关闭', 'zh-Hant': '關閉'},
 'settings.arrows':  {en: 'Arrows', 'zh-Hans': '方向键', 'zh-Hant': '方向鍵'},
 'settings.full':    {en: 'Full', 'zh-Hans': '完整', 'zh-Hant': '完整'},
 'settings.motion':  {en: 'Reduced motion', 'zh-Hans': '减少动态效果', 'zh-Hant': '減少動態效果'},
 'settings.motionNote': {en: 'Follows your device setting', 'zh-Hans': '跟随设备设置', 'zh-Hant': '跟隨裝置設定'},
 'settings.on':      {en: 'On', 'zh-Hans': '开启', 'zh-Hant': '開啟'},
 'settings.gated':   {en: 'Access remains private', 'zh-Hans': '保持私密访问', 'zh-Hant': '保持私密存取'},
 'settings.gatedNote': {en: 'Cloudflare Access', 'zh-Hans': 'Cloudflare Access', 'zh-Hant': 'Cloudflare Access'},
 'settings.pinyin':  {en: 'Show pinyin under Chinese names', 'zh-Hans': '在中文名称下显示拼音', 'zh-Hant': '在中文名稱下顯示拼音'},
 'settings.pinyinNote': {en: 'Tone marks, loaded only when enabled. Saved on this device.', 'zh-Hans': '带声调，仅开启时载入。保存在此设备。', 'zh-Hant': '含聲調，僅開啟時載入。儲存在此裝置。'},
 'settings.preview': {en: 'Chinese name preview', 'zh-Hans': '中文名称预览', 'zh-Hant': '中文名稱預覽'},
 'settings.pending': {en: 'Arrives in S4', 'zh-Hans': '将在 S4 提供', 'zh-Hant': '將於 S4 提供'},
 'settings.langNote': {en: 'Names, descriptions and the interface all follow this setting. Saved on this device.', 'zh-Hans': '名称、说明与界面都跟随此设置。保存在此设备。', 'zh-Hant': '名稱、說明與介面都跟隨此設定。儲存在此裝置。'},

 // ── About: the complete source chain. Every line below was read out of a real file in this repo
 //    at authoring time (LICENSE, public/ATTRIBUTION.md, README-adrian.md, package.json) — the
 //    mock's `about.missing` placeholder is deliberately NOT carried, because the two facts it said
 //    were unavailable (the upstream revision and the MIT copyright holder) are both present here.
 'about.lead':     {en: 'A reference atlas for learning anatomy.', 'zh-Hans': '用于学习解剖的参考图谱。', 'zh-Hant': '用於學習解剖的參考圖譜。'},
 'about.code':     {en: 'Code & license', 'zh-Hans': '代码与许可', 'zh-Hant': '程式碼與授權'},
 'about.repo':     {en: 'Upstream: ashemag/human-atlas — MIT, © 2026 ashemag. Fork: AdrianGanJY/human-anatomy-viewer, built from upstream 7a383d3.', 'zh-Hans': '上游：ashemag/human-atlas — MIT，© 2026 ashemag。分支：AdrianGanJY/human-anatomy-viewer，基于上游 7a383d3 构建。', 'zh-Hant': '上游：ashemag/human-atlas — MIT，© 2026 ashemag。分支：AdrianGanJY/human-anatomy-viewer，基於上游 7a383d3 建置。'},
 'about.upstream': {en: 'GitHub · upstream', 'zh-Hans': 'GitHub · 上游', 'zh-Hant': 'GitHub · 上游'},
 'about.fork':     {en: 'GitHub · fork', 'zh-Hans': 'GitHub · 分支', 'zh-Hant': 'GitHub · 分支'},
 'about.anatomy':  {en: 'Anatomy data', 'zh-Hans': '解剖数据', 'zh-Hant': '解剖資料'},
 'about.attribution': {en: 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.', 'zh-Hans': 'BodyParts3D，© 生命科学数据库中心，采用 CC 署名 4.0 国际许可。', 'zh-Hant': 'BodyParts3D，© 生命科學資料庫中心，採用 CC 姓名標示 4.0 國際授權。'},
 'about.adapt':    {en: 'BodyParts3D 4.0 · TARO adult male reference, from isa_BP3D_4.0_obj_99.zip. Axes and units converted from millimetres/Z-up to metres/Y-up; geometry simplified with meshoptimizer at a 0.2% relative error limit; normals quantized to signed 16-bit; meshes packed into chunks; display groups curated. 3,432 concepts / 2,234 meshes. Educational use; not a clinical tool.', 'zh-Hans': 'BodyParts3D 4.0 · TARO 成年男性参考模型，源自 isa_BP3D_4.0_obj_99.zip。坐标与单位由毫米／Z 轴向上转换为米／Y 轴向上；以 meshoptimizer 按 0.2% 相对误差简化几何；法线量化为有符号 16 位；网格分块；显示分组经人工整理。3,432 个概念 / 2,234 个网格。用于教育，非临床工具。', 'zh-Hant': 'BodyParts3D 4.0 · TARO 成年男性參考模型，源自 isa_BP3D_4.0_obj_99.zip。座標與單位由毫米／Z 軸向上轉換為公尺／Y 軸向上；以 meshoptimizer 按 0.2% 相對誤差簡化幾何；法線量化為有號 16 位元；網格分塊；顯示分組經人工整理。3,432 個概念 / 2,234 個網格。用於教育，非臨床工具。'},
 'about.legacy':   {en: 'The source OBJ comments name an older CC BY-SA 2.1 Japan licence. The current database licence linked above supersedes that legacy text and explicitly permits redistribution and adaptation under CC BY 4.0.', 'zh-Hans': '源 OBJ 注释中提到较早的 CC BY-SA 2.1 日本许可。上方链接的现行数据库许可取代该旧文本，并明确允许在 CC BY 4.0 下再分发与改编。', 'zh-Hant': '原始 OBJ 註解中提到較早的 CC BY-SA 2.1 日本授權。上方連結的現行資料庫授權取代該舊文字，並明確允許在 CC BY 4.0 下再散布與改作。'},
 'about.paper':    {en: 'Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts.', 'zh-Hans': 'Mitsuhashi 等（2009），BodyParts3D：解剖概念的三维结构数据库。', 'zh-Hant': 'Mitsuhashi 等（2009），BodyParts3D：解剖概念的三維結構資料庫。'},
 'about.language': {en: 'Names & translations', 'zh-Hans': '名称与翻译', 'zh-Hant': '名稱與翻譯'},
 'about.translation': {en: 'Wikidata P1402 anchors; Wikipedia references (no article text imported). Machine translation: codex gpt-6-astra, second-model grading and manual corrections; OpenCC script conversion. Not every term is independently verified.', 'zh-Hans': 'Wikidata P1402 锚点；Wikipedia 参考资料（未导入文章正文）。机器翻译：codex gpt-6-astra、第二模型评分及人工修正；OpenCC 简繁转换。并非每个术语都经独立核实。', 'zh-Hant': 'Wikidata P1402 錨點；Wikipedia 參考資料（未匯入文章正文）。機器翻譯：codex gpt-6-astra、第二模型評分及人工修正；OpenCC 簡繁轉換。並非每個術語都經獨立核實。'},
 'about.pinyin':   {en: 'Pinyin: a build-time whole-word dictionary. The library and its pinned version are recorded here when S4 ships it.', 'zh-Hans': '拼音：构建时生成的整词词典。所用库及锁定版本将在 S4 交付时记录于此。', 'zh-Hant': '拼音：建置時產生的整詞詞典。所用函式庫及鎖定版本將在 S4 交付時記錄於此。'},
 'about.fonts':    {en: 'Fonts', 'zh-Hans': '字体', 'zh-Hant': '字型'},
 'about.fontList': {en: 'No webfont is downloaded. Installed faces only — Latin: Inter, Segoe UI, Roboto, Arial. Chinese: PingFang SC/TC, Noto Sans CJK SC/TC, Source Han Sans, Hiragino Sans GB, Microsoft YaHei/JhengHei.', 'zh-Hans': '不下载任何网络字体，仅使用本机已安装字体 — 拉丁：Inter、Segoe UI、Roboto、Arial；中文：苹方 SC/TC、Noto Sans CJK SC/TC、思源黑体、冬青黑体、微软雅黑／正黑体。', 'zh-Hant': '不下載任何網路字型，僅使用本機已安裝字型 — 拉丁：Inter、Segoe UI、Roboto、Arial；中文：蘋方 SC/TC、Noto Sans CJK SC/TC、思源黑體、冬青黑體、微軟雅黑／正黑體。'},
 'about.runtime':  {en: 'Rendering & hosting', 'zh-Hans': '渲染与托管', 'zh-Hant': '算繪與託管'},
 'about.runtimeList': {en: 'React 19 · three.js r159 · Vite · meshoptimizer · OpenCC. Cloudflare Pages and Functions, Browser Rendering, R2 and Access.', 'zh-Hans': 'React 19 · three.js r159 · Vite · meshoptimizer · OpenCC。Cloudflare Pages 与 Functions、Browser Rendering、R2 与 Access。', 'zh-Hant': 'React 19 · three.js r159 · Vite · meshoptimizer · OpenCC。Cloudflare Pages 與 Functions、Browser Rendering、R2 與 Access。'},
 'about.historical': {en: 'Historical assets — not loaded', 'zh-Hans': '历史资源 — 当前未载入', 'zh-Hant': '歷史資源 — 目前未載入'},
 'about.history':  {en: 'Human Reference Atlas / HuBMAP, 3D Reference Organ Set for Female v1.5 (2023), Kristen Browne and Heidi Schlehlein, CC BY 4.0. Earlier geometry was translated, welded and simplified; it is not part of this model.', 'zh-Hans': 'Human Reference Atlas / HuBMAP，女性参考器官集 v1.5（2023），Kristen Browne 与 Heidi Schlehlein，CC BY 4.0。早期几何经平移、焊接和简化；不属于当前模型。', 'zh-Hant': 'Human Reference Atlas / HuBMAP，女性參考器官集 v1.5（2023），Kristen Browne 與 Heidi Schlehlein，CC BY 4.0。早期幾何經平移、焊接和簡化；不屬於目前模型。'},
 'about.build':    {en: 'Deployed build {build} · commit {commit}', 'zh-Hans': '部署版本 {build} · 提交 {commit}', 'zh-Hant': '部署版本 {build} · 提交 {commit}'},
 'about.notices':  {en: 'Per-dependency licence notices are generated from the resolved package set at build time; this list names the sources, not the full notice text.', 'zh-Hans': '各依赖的许可声明在构建时由实际解析的依赖集生成；此处列出来源，不含完整声明正文。', 'zh-Hant': '各相依套件的授權聲明在建置時由實際解析的相依集產生；此處列出來源，不含完整聲明正文。'},

 // ── the key map (`?`) ──────────────────────────────────────────────────────────────────────────
 'keys.title':     {en: 'Keyboard', 'zh-Hans': '快捷键', 'zh-Hant': '快捷鍵'},
 'keys.scope':     {en: 'Camera keys only work with the field focused. Typing, IME composition, dialogs and tree arrows never move the camera.', 'zh-Hans': '仅模型区域聚焦时响应视角按键。输入、输入法、弹窗与树状导航不会移动视角。', 'zh-Hant': '僅模型區域聚焦時回應視角按鍵。輸入、輸入法、彈窗與樹狀導覽不會移動視角。'},
 'keys.now':       {en: 'Available now', 'zh-Hans': '现在可用', 'zh-Hant': '現在可用'},
 'keys.camera':    {en: 'Camera — field focused', 'zh-Hans': '视角 — 模型区域聚焦时', 'zh-Hant': '視角 — 模型區域聚焦時'},
 'keys.global':    {en: 'Global', 'zh-Hans': '全局', 'zh-Hant': '全域'},
 'keys.tree':      {en: 'Layers tree', 'zh-Hans': '图层树', 'zh-Hant': '圖層樹'},
 'keys.esc':       {en: 'Close the top overlay, or leave presentation mode', 'zh-Hans': '关闭最上层弹层，或退出展示模式', 'zh-Hant': '關閉最上層彈層，或退出展示模式'},
 'keys.help':      {en: 'This key map', 'zh-Hans': '这张快捷键表', 'zh-Hant': '這張快捷鍵表'},
 'keys.find':      {en: 'Find a structure', 'zh-Hans': '查找结构', 'zh-Hant': '查找結構'},
 'keys.settings':  {en: 'Settings', 'zh-Hans': '设置', 'zh-Hant': '設定'},
 'keys.panels':    {en: 'Layers / Selection / JSON / Ask / Info', 'zh-Hans': '图层／所选／JSON／提问／信息', 'zh-Hant': '圖層／所選／JSON／提問／資訊'},
 'keys.sides':     {en: 'Toggle the left and right panels', 'zh-Hans': '开关左右面板', 'zh-Hant': '開關左右面板'},
 'keys.snapStage': {en: 'Snapshot / presentation mode', 'zh-Hans': '截图／展示模式', 'zh-Hant': '截圖／展示模式'},
 'keys.pan':       {en: 'Pan up, left, down, right', 'zh-Hans': '向上、左、下、右平移', 'zh-Hant': '向上、左、下、右平移'},
 'keys.orbit':     {en: 'Orbit around the body', 'zh-Hans': '绕人体旋转', 'zh-Hant': '繞人體旋轉'},
 'keys.dolly':     {en: 'Move closer or further away', 'zh-Hans': '拉近或拉远', 'zh-Hant': '拉近或拉遠'},
 'keys.tilt':      {en: 'Tilt up and down', 'zh-Hans': '上下俯仰', 'zh-Hant': '上下俯仰'},
 'keys.zoom':      {en: 'Zoom', 'zh-Hans': '缩放', 'zh-Hant': '縮放'},
 'keys.modes':     {en: 'Orbit mode / Pan mode', 'zh-Hans': '旋转模式／平移模式', 'zh-Hant': '旋轉模式／平移模式'},
 'keys.views':     {en: 'Three-quarter / Front / Side / Back', 'zh-Hans': '四分之三／前视／侧视／后视', 'zh-Hant': '四分之三／前視／側視／後視'},
 'keys.focusFit':  {en: 'Focus the current structure / fit the whole selection', 'zh-Hans': '聚焦当前结构／适配全部所选', 'zh-Hant': '聚焦目前結構／適配全部所選'},
 'keys.homeReset': {en: 'Whole body / reset the view', 'zh-Hans': '全身视图／重置视角', 'zh-Hant': '全身視圖／重置視角'},
 'keys.hideClear': {en: 'Hide others / clear the selection', 'zh-Hans': '隐藏其他／清空所选', 'zh-Hant': '隱藏其他／清空所選'},
 'keys.treeMove':  {en: 'Move between rows; expand and collapse', 'zh-Hans': '在行间移动；展开与折叠', 'zh-Hant': '在列間移動；展開與摺疊'},
 'keys.treeTick':  {en: 'Add or remove this structure', 'zh-Hans': '加入或移除此结构', 'zh-Hant': '加入或移除此結構'},
 // The inert marker, and the one string that must never read as a promise of a date.
 'inert.pending':  {en: 'Arrives in {s}', 'zh-Hans': '将在 {s} 提供', 'zh-Hant': '將於 {s} 提供'},
};

/**
 * ENGLISH SINGULARS. `{n} pieces` printed "1 pieces" on the screenshot Adrian sent
 * (v21-design.md:912) — and the design's own wireframe drew "1 piece", so the spec and the picture
 * disagreed while the code matched neither.
 *
 * ENGLISH ONLY, DELIBERATELY. Chinese has no grammatical number: 个部件 is correct for one and for
 * a thousand, so a per-language plural table would be three rows to express one rule and two of
 * them would be identical to the base. Nothing here falls back — a key absent from this table
 * keeps its `V2` row exactly as before.
 *
 * THE AUDIT (critic gap 7 asks for it explicitly). Every `{n}` string in `V2`:
 *   `margin.pieces` — "{n} pieces" → needs a singular. Listed below.
 *   `rail.more`     — "{n} more"   → "1 more" is already correct English. NOT listed, on purpose;
 *                                    adding it would be a change with no defect behind it.
 * No other row interpolates a count (`entry.bytes` takes {done}/{total}, `rail.focus` and
 * `search.add` take {name}).
 */
export const V2_ONE: Record<string, string> = {
 'margin.pieces': '{n} piece',
 // L31 v2.1b+c, S0 — every NEW row that interpolates `{n}` and whose English singular differs
 // (opus-plan-review-2.md RC13; G7 itself is already fixed above and is NOT re-fixed here).
 // The audit of the S0 additions, in full:
 //   `status.ready` / `status.all`  — "{n} chunks"     → a one-chunk scene is real (a small
 //                                                        selection), so both need a singular.
 //   `panel.structures`             — "{n} structures" → needed.
 //   `ask.context`                  — "{n} structures" → needed.
 //   `panel.close` / `inert.pending`— {name} / {s}     → not counts. No singular.
 //   `panel.inventory` / `panel.meshes` / `json.limit` — FIXED numbers from the manifest, no
 //                                                        placeholder at all, so nothing to plural.
 'status.ready': 'Scene ready · {mb} MB · {n} chunk',
 'status.all': 'Whole body loaded · {n} chunk',
 'panel.structures': '{n} structure',
 'ask.context': 'Included: {n} structure and this scene link',
};

/** `{n}`-style placeholders, same contract as `i18n/ui.ts fmt`, plus the English singular above. */
export function v2t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
 const row = V2[key];
 if (!row) return key;
 let s = row[lang] ?? row.en;
 if (!vars) return s;
 // `n` reaches here already localised (`(1234).toLocaleString()` ⇒ "1,234"), so the separators are
 // stripped before parsing: "1,024" becomes 1024, which is not 1, which is the plural. (An earlier
 // note here claimed the separator produced NaN — it does not, because the strip runs first; the
 // answer was right and the stated reason was wrong.)
 if (lang === 'en' && vars.n !== undefined && Number(String(vars.n).replace(/[\s,]/g, '')) === 1 && V2_ONE[key]) {
  s = V2_ONE[key];
 }
 return s.replace(/\{(\w+)\}/g, (whole, k) => (vars[k] === undefined ? whole : String(vars[k])));
}
