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
import type {Reason} from './controller.ts';

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

 // ── L31 v2.1b+c, S2 — THE FIND PALETTE ────────────────────────────────────────────────────────
 // `spec.md` copy keys `search.cross` / `search.results` / `search.footer` / `search.loading` /
 // `search.retry`. The count-bearing row is `search.results`, whose `{n}` and `{total}` are MEASURED
 // per lane (find.ts) rather than the fixed 3,432 the S0 placeholder carried.
 'search.cross':   {en: 'Searches English, 简体 and 繁體 at once — whatever the interface is set to.', 'zh-Hans': '同时检索英文、简体与繁體 — 与界面语言无关。', 'zh-Hant': '同時檢索英文、簡體與繁體 — 與介面語言無關。'},
 'search.results': {en: '{n} of {total}', 'zh-Hans': '{total} 中的 {n}', 'zh-Hant': '{total} 中的 {n}'},
 'search.footer':  {en: 'Enter replaces the selection · Shift+Enter adds · Esc closes', 'zh-Hans': 'Enter 替换所选 · Shift+Enter 加入 · Esc 关闭', 'zh-Hant': 'Enter 替換所選 · Shift+Enter 加入 · Esc 關閉'},
 'search.capped':  {en: 'Showing the first {n} in each group · narrow the query to see the rest', 'zh-Hans': '每组仅显示前 {n} 条 · 缩小查询范围可查看其余', 'zh-Hant': '每組僅顯示前 {n} 條 · 縮小查詢範圍可檢視其餘'},
 'search.loading': {en: 'Loading the Chinese names…', 'zh-Hans': '正在载入中文名称…', 'zh-Hant': '正在載入中文名稱…'},
 // The PARTIAL state (X2). It says what is missing and what happens next, because "retrying
 // automatically" is only reassuring if the reader is told when.
 'search.partial': {en: 'One Chinese script did not load — reopening Find retries it.', 'zh-Hans': '有一种中文字形未能载入 — 重新打开查找会再试一次。', 'zh-Hant': '有一種中文字形未能載入 — 重新開啟查找會再試一次。'},
 // The TOTAL-failure case, which used to fall through the partial banner's `loadedLanes() > 0`
 // gate and leave a Chinese query reading "No structures match." — a claim about the atlas made
 // when the truth was that no dictionary had loaded (stand-in review S2 r1, M1).
 'search.noneLoaded': {en: 'The Chinese names could not be loaded, so Chinese queries find nothing yet.', 'zh-Hans': '中文名称未能载入，因此暂时无法用中文检索。', 'zh-Hant': '中文名稱未能載入，因此暫時無法用中文檢索。'},
 'search.retry':   {en: 'Try again', 'zh-Hans': '重试', 'zh-Hant': '重試'},
 'search.recent':  {en: 'Recent and selected', 'zh-Hans': '最近与所选', 'zh-Hant': '最近與所選'},
 'search.laneSystems':  {en: 'Systems', 'zh-Hans': '系统', 'zh-Hant': '系統'},
 'search.laneConcepts': {en: 'Structures', 'zh-Hans': '结构', 'zh-Hant': '結構'},
 'search.laneParts':    {en: 'Individual meshes', 'zh-Hans': '独立网格', 'zh-Hant': '獨立網格'},
 'search.scopeTo':      {en: 'Narrow to this system', 'zh-Hans': '限定此系统', 'zh-Hant': '限定此系統'},
 'search.scopeClear':   {en: 'Search every system again', 'zh-Hans': '恢复检索全部系统', 'zh-Hant': '恢復檢索全部系統'},

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

 // ══ L31 v2.1b+c, S3 — THE LAYERS / SYSTEMS TREE ════════════════════════════════════════════════
 // ⚠️ `tree.inventory` REPLACES the hard-coded `panel.inventory` ("15 systems · 3,432 structures").
 // That literal was correct on the day it was written and is exactly the staleness magnet the
 // doc-authoring rule names: it would go on claiming 3,432 the first time the manifest is
 // re-curated. The numbers now come from the atlas that is actually loaded. `panel.inventory` is
 // KEPT, not deleted — the phone's systems panel still reads it until S6 — but nothing in the
 // studio uses it any more.
 'tree.inventory': {en: '{s} systems · {c} structures', 'zh-Hans': '{s} 个系统 · {c} 个结构', 'zh-Hant': '{s} 個系統 · {c} 個結構'},
 // BOTH DENOMINATORS, NAMED, because systems and structures are two populations and one merged
 // "12 of 3,447" would be the specific lie the palette's footer already refuses.
 'tree.filtered':  {en: '{s} of {sn} systems · {c} of {cn} structures', 'zh-Hans': '{sn} 个系统中的 {s} 个 · {cn} 个结构中的 {c} 个', 'zh-Hant': '{sn} 個系統中的 {s} 個 · {cn} 個結構中的 {c} 個'},
 'tree.noMatch':   {en: 'Nothing in the tree matches that.', 'zh-Hans': '图层中没有匹配项。', 'zh-Hant': '圖層中沒有符合項。'},
 'tree.expand':    {en: 'Expand {name}', 'zh-Hans': '展开{name}', 'zh-Hant': '展開{name}'},
 'tree.collapse':  {en: 'Collapse {name}', 'zh-Hans': '收起{name}', 'zh-Hant': '收起{name}'},
 'tree.tickOn':    {en: 'Add {name} to this view', 'zh-Hans': '把{name}加入本视图', 'zh-Hant': '把{name}加入本視圖'},
 'tree.tickOff':   {en: 'Remove {name} from this view', 'zh-Hans': '把{name}移出本视图', 'zh-Hant': '把{name}移出本視圖'},
 'tree.tick':      {en: 'Tick = in this view', 'zh-Hans': '勾选 = 加入本视图', 'zh-Hant': '勾選 = 加入本視圖'},
 'tree.tickSystem': {en: 'Ticks every structure in this system at once — a view holds 24, so a large system is refused whole', 'zh-Hans': '一次勾选本系统的全部结构 — 视图上限为 24 个，超出时整体拒绝', 'zh-Hant': '一次勾選本系統的全部結構 — 視圖上限為 24 個，超出時整體拒絕'},
 // "Included through {name}" — the covered child. Described, never a false checkmark.
 'tree.covered':   {en: 'Included through {name}', 'zh-Hans': '已随{name}一并显示', 'zh-Hant': '已隨{name}一併顯示'},
 // ⚠️ S3b — THE THREE NOTES AN HONEST EYE NEEDS (codex round 4, H3 + H4). Each explains a case where
 // the control now reports what the RENDERER draws rather than its own declaration, and where the
 // difference would otherwise read as a broken control.
 // SHORTENED so it FITS the 264 px sidebar row — the first wording truncated to "Still drawn
 // through …", which names nothing, and the whole point of the note is the name.
 'tree.drawnThrough': {en: 'Drawn through {name}', 'zh-Hans': '通过{name}绘制', 'zh-Hant': '透過{name}繪製'},
 // ONE STATEMENT ABOUT THE VIEW, replacing a note that repeated on every diverging system row (which
 // after a ghost scene is all of them). `{n}` is MEASURED, and both singulars are in V2_ONE.
 'tree.viewOverridesShow': {en: 'This view is showing {n} systems its own way — your own set is unchanged', 'zh-Hans': '本视图以自己的方式显示了 {n} 个系统 — 你的设置未改动', 'zh-Hant': '本視圖以自己的方式顯示了 {n} 個系統 — 你的設定未改動'},
 'tree.viewOverridesHide': {en: 'This view is hiding {n} systems your set has on — your own set is unchanged', 'zh-Hans': '本视图隐藏了你设置中开启的 {n} 个系统 — 你的设置未改动', 'zh-Hant': '本視圖隱藏了你設定中開啟的 {n} 個系統 — 你的設定未改動'},
 // S3b round 5, Medium 4: the eye owns the session override and the scene's style, and it owns
 // NEITHER the system switch — so on that cause it says so instead of offering a click that cannot
 // work. The note names the system, because that IS the control the reader needs.
 'tree.hiddenWithSystem': {en: 'Hidden with the {name} system', 'zh-Hans': '随{name}系统一并隐藏', 'zh-Hant': '隨{name}系統一併隱藏'},
 'tree.eyeSystemOff': {en: 'Its system is switched off — use the system row above to show it', 'zh-Hans': '所属系统已关闭 — 请用上方的系统行显示', 'zh-Hant': '所屬系統已關閉 — 請用上方的系統列顯示'},
 // ⚠️ S3c — TWO MORE REASONS AN EYE CAN BE INERT, because "its system is switched off" was being
 // said over an ENABLED system (codex round 7, Medium 3, third case). An inert control owes an
 // ACCURATE adjacent reason, which means one string per lane, not one string for the whole class.
 'tree.hiddenByIsolate': {en: 'Isolation is drawing only the selection — tick this structure, or turn isolation off', 'zh-Hans': '独显模式只绘制所选内容 — 勾选此结构,或关闭独显', 'zh-Hant': '獨顯模式只繪製所選內容 — 勾選此結構,或關閉獨顯'},
 'tree.hiddenByScene': {en: 'This view draws it at zero — the eye cannot change that', 'zh-Hans': '本视图将其绘制为 0 — 此按钮无法改变', 'zh-Hant': '本視圖將其繪製為 0 — 此按鈕無法改變'},
 // codex round 8, Medium 1: an inert eye over a DRAWN structure. Its meshes are being supplied by
 // a structure this one shares them with, so hiding it here would change nothing on screen.
 'tree.eyeShared': {en: 'Its meshes are drawn by {name} — hiding it here would change nothing', 'zh-Hans': '它的网格由{name}绘制 — 在此隐藏不会改变画面', 'zh-Hant': '它的網格由{name}繪製 — 在此隱藏不會改變畫面'},
 'tree.eyeSharedAnon': {en: 'Its meshes are drawn by another selected structure — hiding it here would change nothing', 'zh-Hans': '它的网格由另一个已选结构绘制 — 在此隐藏不会改变画面', 'zh-Hant': '它的網格由另一個已選結構繪製 — 在此隱藏不會改變畫面'},
 'tree.hide':      {en: 'hide', 'zh-Hans': '隐藏', 'zh-Hant': '隱藏'},
 'tree.show':      {en: 'show', 'zh-Hans': '显示', 'zh-Hant': '顯示'},
 // ⚠️ EVERY EYE STATES ITS OWN SERIALISATION. RC8 refuses an eye whose tooltip does not: the reader
 // has to know, before clicking, whether the link they copy afterwards reproduces what they see.
 // ⚠️ S3b ROUND 6 — THE PROMISE IS NARROWED TO WHAT ACTUALLY ROUND-TRIPS. These said "saved in the
 // link (system=)" flatly, and codex round 6 measured two cases where that is false: the key is
 // OMITTED when the set equals the default, and a saved view carrying a skeletal ghost re-applies it
 // on arrival. RC8 refuses an eye whose tooltip misstates its serialisation, so the tooltip says
 // what is true today — the link carries the drawn set, and a saved view can override it — rather
 // than a promise the URL vocabulary cannot keep. The durable fix is escalated, not claimed here.
 'tree.eyeSystem': {en: 'Whole system — the link carries the drawn set (system=); a saved view can override it when reopened', 'zh-Hans': '整个系统 — 链接会带上当前绘制的系统集合（system=）；重新打开已保存的视图时可能被覆盖', 'zh-Hant': '整個系統 — 連結會帶上目前繪製的系統集合（system=）；重新開啟已保存的視圖時可能被覆蓋'},
 'tree.eyeSystemIsolate': {en: 'Whole system — the link carries the drawn set (system=); a saved view can override it when reopened. This also turns off Hide others.', 'zh-Hans': '整个系统 — 链接会带上当前绘制的系统集合（system=）；重新打开已保存的视图时可能被覆盖。这同时会关闭“隐藏其他”。', 'zh-Hant': '整個系統 — 連結會帶上目前繪製的系統集合（system=）；重新開啟已保存的視圖時可能被覆蓋。這同時會關閉「隱藏其他」。'},
 'tree.eyeMember': {en: 'Saved in this view as opacity 0 — the same setting as the Opacity slider', 'zh-Hans': '在本视图中保存为不透明度 0 — 与不透明度滑块是同一项设置', 'zh-Hant': '在本視圖中保存為不透明度 0 — 與不透明度滑桿是同一項設定'},
 'tree.eyeSession': {en: 'This session only — not saved in the link, and cleared when a view is opened', 'zh-Hans': '仅限本次会话 — 不会保存在链接中，打开视图时会清除', 'zh-Hant': '僅限本次工作階段 — 不會保存在連結中，開啟視圖時會清除'},
 'tree.sessionHidden': {en: '{n} structures hidden for this session only', 'zh-Hans': '{n} 个结构仅在本次会话中隐藏', 'zh-Hant': '{n} 個結構僅在本次工作階段中隱藏'},
 'tree.opacityOf': {en: 'Opacity of {name}', 'zh-Hans': '{name}的不透明度', 'zh-Hant': '{name}的不透明度'},
 'tree.hiddenWord': {en: 'Hidden', 'zh-Hans': '已隐藏', 'zh-Hant': '已隱藏'},

 // ── THE ATOMIC REFUSAL (`spec.md` D11). The SENTENCE itself comes from the controller — it is the
 //    one place that knows which bound was hit and by how much — so these are the frame around it:
 //    a title, the limits, the unchanged count, and the corrective action. The numbers in
 //    `refusal.limit` are the codec's own constants and are FIXED, not placeholders.
 'refusal.title':  {en: 'Not added — nothing was changed', 'zh-Hans': '未添加 — 当前视图未作更改', 'zh-Hant': '未加入 — 目前視圖未作更改'},
 'refusal.limit':  {en: 'Maximum: 24 structures · 1,400 encoded characters', 'zh-Hans': '上限：24 个结构 · 1,400 个编码字符', 'zh-Hant': '上限：24 個結構 · 1,400 個編碼字元'},
 'refusal.unchanged': {en: 'Your {n} structures are unchanged.', 'zh-Hans': '你的 {n} 个结构保持不变。', 'zh-Hant': '你的 {n} 個結構保持不變。'},
 'refusal.review': {en: 'Review selection', 'zh-Hans': '检查所选结构', 'zh-Hant': '檢查所選結構'},

 // ══ L31 v2.1b+c, S4 — THE REASON ITSELF, KEYED ═════════════════════════════════════════════════
 //
 // ⚠️ THIS IS A LIVE DEFECT S3 SHIPPED, not a new feature. `app/v2/controller.ts` produced its ~14
 // refusal reasons as English string LITERALS, and S3 added the first surface at >=1180 that draws
 // them. The result, measured on the live site in a 简体 interface (worklog 2026-09-13, S3c):
 //
 //   未添加 — 当前视图未作更改 that is 838 structures and the maximum is 24 — remove some first
 //   你的 5 个结构保持不变
 //
 // A translated frame wrapped around a raw English sentence — and the English is the only part that
 // says what went wrong. So the controller now returns a `Reason` (`{key, vars, detail}`) and THIS
 // TABLE is what turns it into words. The controller stays UI-free: it names the bound it hit and
 // the numbers, and knows nothing about any language.
 //
 // WHY KEYS AND NOT `tr` THREADED INTO THE CONTROLLER. `reduce` is a pure function with ~40 tests
 // and two non-React callers (`window.atlas`, the URL seed); handing it a translator would make
 // every one of them supply one, and would put the interface language inside the one module whose
 // whole value is that it has no interface in it.
 //
 // ⚠️ `v2t` RETURNS THE KEY FOR A MISSING ROW — which would be a Latin-only string in a Chinese
 // card, i.e. exactly this defect again in a new costume (it already happened once: S2 shipped
 // `tr('refusal.tooMany')` against a key that did not exist and the palette rendered the key).
 // `test/v2-copy-reasons.test.mjs` enumerates every key the controller can emit and asserts each
 // has a row here with CJK in both Chinese columns. That test is the guard, not this comment.
 //
 // THE `{n}` AUDIT (RC13), in full: `refusal.limitStructures` interpolates `{n} structures` and
 // `refusal.encoded`/`refusal.linkEncoded` interpolate `{n} characters` — in all three, `{n}` is
 // strictly GREATER than its bound by construction (>24, >1,400), so the English singular is
 // unreachable copy and none of them belongs in `V2_ONE`. `refusal.addFull` interpolates `{max}`,
 // which is a constant, not a count of anything the reader has.
 'refusal.limitStructures': {
  en: 'that is {n} structures and the maximum is {max} — remove some first',
  'zh-Hans': '这是 {n} 个结构，上限为 {max} 个 — 请先移除一些',
  'zh-Hant': '這是 {n} 個結構，上限為 {max} 個 — 請先移除一些',
 },
 'refusal.encoded': {
  en: 'this scene encodes to {n} characters and the limit is {max} — remove a structure, or shorten the title or note',
  'zh-Hans': '这个场景编码后有 {n} 个字符，上限为 {max} 个 — 请移除一个结构，或缩短标题或备注',
  'zh-Hant': '這個場景編碼後有 {n} 個字元，上限為 {max} 個 — 請移除一個結構，或縮短標題或備註',
 },
 'refusal.addFull': {
  en: 'a view holds at most {max} structures — remove one first',
  'zh-Hans': '一个视图最多容纳 {max} 个结构 — 请先移除一个',
  'zh-Hant': '一個視圖最多容納 {max} 個結構 — 請先移除一個',
 },
 'refusal.lastStructure': {
  en: 'a view needs at least one structure — use Clear to leave this view',
  'zh-Hans': '一个视图至少需要一个结构 — 如要离开此视图，请使用“清空”',
  'zh-Hant': '一個視圖至少需要一個結構 — 如要離開此視圖，請使用「清空」',
 },
 'refusal.nothing': {
  en: 'nothing to select',
  'zh-Hans': '没有可选择的结构',
  'zh-Hant': '沒有可選擇的結構',
 },
 'refusal.opacityNoScene': {
  en: 'opacity is part of a saved view — this page is not showing one',
  'zh-Hans': '不透明度属于已保存的视图 — 当前页面没有在显示视图',
  'zh-Hant': '不透明度屬於已儲存的視圖 — 目前頁面沒有在顯示視圖',
 },
 'refusal.opacityNotMember': {
  en: 'opacity applies to a structure in this view — add it first',
  'zh-Hans': '不透明度只作用于本视图中的结构 — 请先将它加入本视图',
  'zh-Hant': '不透明度只作用於本視圖中的結構 — 請先將它加入本視圖',
 },
 'refusal.linkEncoded': {
  en: "this link's view encodes to {n} characters and the limit is {max}",
  'zh-Hans': '这个链接的视图编码后有 {n} 个字符，上限为 {max} 个',
  'zh-Hant': '這個連結的視圖編碼後有 {n} 個字元，上限為 {max} 個',
 },
 // ⚠️ THE ONE PAIR WHOSE DETAIL STAYS ENGLISH, AND IT IS SAID OUT LOUD RATHER THAN HIDDEN.
 // `validateScene` lives in `app/scene-codec.js` and produces ~17 English sentences of its own
 // ("focus.ids contains …, which is not in select, context or ghost", "unknown emphasis …"). That
 // file is inside `deploy.ps1`'s `renderPaths`, so keying it means a SITE_BUILD bump, a Worker
 // deploy and a plate-golden comparison — out of S4's scope by the kickoff's own terms.
 //
 // So the SENTENCE the reader reads is translated, and the codec's English is carried as a
 // labelled technical quotation under it (`refusal.detail`) rather than spliced into the middle of
 // a Chinese paragraph. That is honest in a way "some of it is translated" is not, and it is
 // reachable only by a malformed link or a hand-edited scene — never by the over-tick that made
 // this defect visible. Owner for keying the codec: whoever next opens the render path.
 'refusal.sceneInvalid': {
  en: 'this view could not be applied',
  'zh-Hans': '这个视图无法应用',
  'zh-Hant': '這個視圖無法套用',
 },
 'refusal.linkInvalid': {
  en: "this link's view could not be applied",
  'zh-Hans': '这个链接的视图无法应用',
  'zh-Hant': '這個連結的視圖無法套用',
 },
 'refusal.detail': {
  en: 'Technical detail',
  'zh-Hans': '技术细节（英文）',
  'zh-Hant': '技術細節（英文）',
 },

 // Why the opacity slider is disabled in an EXPLORE scene: the codec draws every named structure
 // solid there, so the control cannot express what it looks like it expresses (codex round 3, H1).
 'panel.opacityExplore': {en: 'This view draws every selected structure solid — use the eye in Layers to hide one for this session.', 'zh-Hans': '本视图会把所选结构全部实心绘制 — 如需临时隐藏，请使用图层中的眼睛。', 'zh-Hant': '本視圖會把所選結構全部實心繪製 — 如需暫時隱藏，請使用圖層中的眼睛。'},
 'tree.visKey':    {en: 'V', 'zh-Hans': 'V', 'zh-Hant': 'V'},
 'keys.treeVis':   {en: 'Show or hide the focused row', 'zh-Hans': '显示/隐藏当前行', 'zh-Hant': '顯示/隱藏目前列'},
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
 // ⚠️ S4 — THE RELATIONSHIP TABLES ARE NAMED. `public/ATTRIBUTION.md` credits "English names and
 // relationships: IS-A and PART-OF concept, element, and inclusion tables from the same archive",
 // and About did not mention them. The whole 3,432-concept hierarchy — which is what the Layers tree
 // IS — comes from those tables, so leaving them out of an attribution panel that claims to name
 // every source was a real omission, found by reading ATTRIBUTION.md against this table.
 'about.adapt':    {en: 'BodyParts3D 4.0 · TARO adult male reference, from isa_BP3D_4.0_obj_99.zip. English names and the concept hierarchy come from the same archive\'s IS-A and PART-OF concept, element and inclusion tables. Axes and units converted from millimetres/Z-up to metres/Y-up; geometry simplified with meshoptimizer at a 0.2% relative error limit; normals quantized to signed 16-bit; meshes packed into chunks; display groups curated. 3,432 concepts / 2,234 meshes. Educational use; not a clinical tool.', 'zh-Hans': 'BodyParts3D 4.0 · TARO 成年男性参考模型，源自 isa_BP3D_4.0_obj_99.zip。英文名称与概念层级来自同一档案的 IS-A、PART-OF 概念表、元素表与包含关系表。坐标与单位由毫米／Z 轴向上转换为米／Y 轴向上；以 meshoptimizer 按 0.2% 相对误差简化几何；法线量化为有符号 16 位；网格分块；显示分组经人工整理。3,432 个概念 / 2,234 个网格。用于教育，非临床工具。', 'zh-Hant': 'BodyParts3D 4.0 · TARO 成年男性參考模型，源自 isa_BP3D_4.0_obj_99.zip。英文名稱與概念層級來自同一檔案的 IS-A、PART-OF 概念表、元素表與包含關係表。座標與單位由毫米／Z 軸向上轉換為公尺／Y 軸向上；以 meshoptimizer 按 0.2% 相對誤差簡化幾何；法線量化為有號 16 位元；網格分塊；顯示分組經人工整理。3,432 個概念 / 2,234 個網格。用於教育，非臨床工具。'},
 'about.dataset':  {en: 'BodyParts3D · dataset', 'zh-Hans': 'BodyParts3D · 数据集', 'zh-Hant': 'BodyParts3D · 資料集'},
 'about.historyDoi': {en: 'HuBMAP · 10.48539/HBM352.BTSQ.586', 'zh-Hans': 'HuBMAP · 10.48539/HBM352.BTSQ.586', 'zh-Hant': 'HuBMAP · 10.48539/HBM352.BTSQ.586'},
 'about.legacy':   {en: 'The source OBJ comments name an older CC BY-SA 2.1 Japan licence. The current database licence linked above supersedes that legacy text and explicitly permits redistribution and adaptation under CC BY 4.0.', 'zh-Hans': '源 OBJ 注释中提到较早的 CC BY-SA 2.1 日本许可。上方链接的现行数据库许可取代该旧文本，并明确允许在 CC BY 4.0 下再分发与改编。', 'zh-Hant': '原始 OBJ 註解中提到較早的 CC BY-SA 2.1 日本授權。上方連結的現行資料庫授權取代該舊文字，並明確允許在 CC BY 4.0 下再散布與改作。'},
 'about.paper':    {en: 'Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts.', 'zh-Hans': 'Mitsuhashi 等（2009），BodyParts3D：解剖概念的三维结构数据库。', 'zh-Hant': 'Mitsuhashi 等（2009），BodyParts3D：解剖概念的三維結構資料庫。'},
 'about.language': {en: 'Names & translations', 'zh-Hans': '名称与翻译', 'zh-Hant': '名稱與翻譯'},
 'about.translation': {en: 'Wikidata P1402 anchors; Wikipedia references (no article text imported). Machine translation: codex gpt-6-astra, second-model grading and manual corrections; OpenCC script conversion. Not every term is independently verified.', 'zh-Hans': 'Wikidata P1402 锚点；Wikipedia 参考资料（未导入文章正文）。机器翻译：codex gpt-6-astra、第二模型评分及人工修正；OpenCC 简繁转换。并非每个术语都经独立核实。', 'zh-Hant': 'Wikidata P1402 錨點；Wikipedia 參考資料（未匯入文章正文）。機器翻譯：codex gpt-6-astra、第二模型評分及人工修正；OpenCC 簡繁轉換。並非每個術語都經獨立核實。'},
 // ⚠️ S4 — THE REAL SOURCE, replacing the S0 placeholder ("recorded here when S4 ships it"). The
 // version is NOT written here: `{lib}` is interpolated from the shipped `public/i18n/pinyin.json`'s
 // own `library` stamp, read at build time (vite.config.ts `readPinyinLib`). A literal here would be
 // the third copy of a version number, and the S1 review is on record about what happens to those.
 // The DERIVATION is stated because it is a real limitation a reader should be able to see: the
 // reading comes from the 简体 spelling, and 繁體 shares it.
 'about.pinyin':   {
  en: 'Pinyin: generated at build time from the 简体 names by {lib}, with tone marks — one reading per atlas id, {n} in all. 繁體 shares the reading, because the two dictionaries are conversions of one another and pinyin is the Mandarin reading rather than a transcript of the glyphs. Downloaded only when the setting is on.',
  'zh-Hans': '拼音：构建时由 {lib} 从简体名称生成，带声调 — 每个图谱编号一条读音，共 {n} 条。繁體沿用同一读音：两份词典互为转换，而拼音是普通话读音，并非字形的转写。仅在开启该设置时下载。',
  'zh-Hant': '拼音：建置時由 {lib} 從簡體名稱產生，含聲調 — 每個圖譜編號一條讀音，共 {n} 條。繁體沿用同一讀音：兩份詞典互為轉換，而拼音是普通話讀音，並非字形的轉寫。僅在開啟該設定時下載。',
 },
 'about.fonts':    {en: 'Fonts', 'zh-Hans': '字体', 'zh-Hant': '字型'},
 'about.fontList': {en: 'No webfont is downloaded. Installed faces only — Latin: Inter, Segoe UI, Roboto, Arial. Chinese: PingFang SC/TC, Noto Sans CJK SC/TC, Source Han Sans, Hiragino Sans GB, Microsoft YaHei/JhengHei.', 'zh-Hans': '不下载任何网络字体，仅使用本机已安装字体 — 拉丁：Inter、Segoe UI、Roboto、Arial；中文：苹方 SC/TC、Noto Sans CJK SC/TC、思源黑体、冬青黑体、微软雅黑／正黑体。', 'zh-Hant': '不下載任何網路字型，僅使用本機已安裝字型 — 拉丁：Inter、Segoe UI、Roboto、Arial；中文：蘋方 SC/TC、Noto Sans CJK SC/TC、思源黑體、冬青黑體、微軟雅黑／正黑體。'},
 'about.runtime':  {en: 'Rendering & hosting', 'zh-Hans': '渲染与托管', 'zh-Hant': '算繪與託管'},
 // ⚠️ S4 — `{deps}` IS THE RESOLVED SET, read out of each package's own `node_modules/…/package.json`
 // at build time (vite.config.ts `readDeps`). It replaced "React 19 · three.js r159 · Vite ·
 // meshoptimizer · OpenCC" — a hand-typed line on the panel whose job is to say what the reader is
 // looking at, i.e. the exact staleness magnet the S1 review caught two lines below it. Hosting is
 // still named by hand because it is not a package and has no version to drift.
 'about.runtimeList': {en: 'Downloaded by your browser: {deps}. Hosted on Cloudflare Pages and Functions, with Browser Rendering, R2 and Access.', 'zh-Hans': '浏览器实际下载：{deps}。托管于 Cloudflare Pages 与 Functions，并使用 Browser Rendering、R2 与 Access。', 'zh-Hant': '瀏覽器實際下載：{deps}。託管於 Cloudflare Pages 與 Functions，並使用 Browser Rendering、R2 與 Access。'},
 'about.historical': {en: 'Historical assets — not loaded', 'zh-Hans': '历史资源 — 当前未载入', 'zh-Hant': '歷史資源 — 目前未載入'},
 'about.history':  {en: 'Human Reference Atlas / HuBMAP, 3D Reference Organ Set for Female v1.5 (2023), Kristen Browne and Heidi Schlehlein, CC BY 4.0. Earlier geometry was translated, welded and simplified; it is not part of this model.', 'zh-Hans': 'Human Reference Atlas / HuBMAP，女性参考器官集 v1.5（2023），Kristen Browne 与 Heidi Schlehlein，CC BY 4.0。早期几何经平移、焊接和简化；不属于当前模型。', 'zh-Hant': 'Human Reference Atlas / HuBMAP，女性參考器官集 v1.5（2023），Kristen Browne 與 Heidi Schlehlein，CC BY 4.0。早期幾何經平移、焊接和簡化；不屬於目前模型。'},
 'about.build':    {en: 'Deployed build {build} · commit {commit}', 'zh-Hans': '部署版本 {build} · 提交 {commit}', 'zh-Hant': '部署版本 {build} · 提交 {commit}'},
 // ⚠️ S4 — CORRECTED. This said the notices "are generated from the resolved package set at build
 // time", and nothing generated anything: the list above it was a hand-typed sentence. The list IS
 // generated now (name, resolved version and declared licence, from each package's own manifest),
 // and what is still absent — the full notice TEXTS — is named as absent instead of implied to be
 // covered. A sentence that describes a pipeline is a claim, and this one was false.
 'about.notices':  {
  // ⚠️ "A SELECTED LIST" is the wording codex round 10 (M3) earned: the names are chosen, and the
  // versions and licences are then read from the resolved tree. Calling it the resolved dependency
  // tree implied completeness the selection cannot promise.
  en: 'A selected list of the packages this page loads and the tools that produced its data; each name\'s version and licence are read at build time from that package\'s own manifest in the resolved tree. The full notice texts are not bundled; each is published with its own project.',
  'zh-Hans': '上表列出本页面加载的主要依赖及生成其数据的工具（名称为人工选定）；各自的版本与许可在构建时从该包在已解析依赖树中的 manifest 读取。完整的许可声明正文未随本站打包，各自随其项目发布。',
  'zh-Hant': '上表列出本頁面載入的主要相依套件及產生其資料的工具（名稱為人工選定）；各自的版本與授權在建置時從該套件在已解析相依樹中的 manifest 讀取。完整的授權聲明正文未隨本站打包，各自隨其專案發布。',
 },

 // ── the key map (`?`) ──────────────────────────────────────────────────────────────────────────
 'keys.title':     {en: 'Keyboard', 'zh-Hans': '快捷键', 'zh-Hant': '快捷鍵'},
 'keys.scope':     {en: 'Camera keys only work with the field focused. Typing, IME composition, dialogs and tree arrows never move the camera.', 'zh-Hans': '仅模型区域聚焦时响应视角按键。输入、输入法、弹窗与树状导航不会移动视角。', 'zh-Hant': '僅模型區域聚焦時回應視角按鍵。輸入、輸入法、彈窗與樹狀導覽不會移動視角。'},
 'keys.now':       {en: 'Available now', 'zh-Hans': '现在可用', 'zh-Hant': '現在可用'},
 'keys.camera':    {en: 'Camera — field focused', 'zh-Hans': '视角 — 模型区域聚焦时', 'zh-Hant': '視角 — 模型區域聚焦時'},
 'keys.global':    {en: 'Global', 'zh-Hans': '全局', 'zh-Hant': '全域'},
 'keys.tree':      {en: 'Layers tree', 'zh-Hans': '图层树', 'zh-Hant': '圖層樹'},
 // GUARD 7 SAYS SO IN THE MAP. The camera keys are withheld below 1180, where there is no pill and
 // no key pad; a key map that listed them as live at 390x844 would be the leaflet this file exists
 // to prevent (round 3, Medium).
 'keys.cameraOff': {en: 'Desktop only — these need the studio layout (1180px and wider)', 'zh-Hans': '仅限桌面 — 需要 1180 像素以上的工作台布局', 'zh-Hant': '僅限桌面 — 需要 1180 像素以上的工作台佈局'},
 'keys.desktopOnly': {en: 'desktop only', 'zh-Hans': '仅限桌面', 'zh-Hant': '僅限桌面'},
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
 // SPLIT. `H` is studio-only (it runs G3's whole-body formula through `__atlasNav`); `R` is a
 // controller dispatch that works at every tier and has an on-screen button on the phone. One row
 // for both meant the map could only mark them together, and marking them together is how the
 // "Desktop only" note came to cover a key that works (round 4, Medium 1).
 'keys.home':      {en: 'Frame the whole body', 'zh-Hans': '全身视图', 'zh-Hant': '全身視圖'},
 'keys.reset':     {en: 'Reset the view', 'zh-Hans': '重置视角', 'zh-Hant': '重置視角'},
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
 // S3b round 7: the two new view-override rows interpolate {n} systems and their English singular
 // differs, so both belong here (RC13).
 'tree.viewOverridesShow': 'This view is showing {n} system its own way — your own set is unchanged',
 'tree.viewOverridesHide': 'This view is hiding {n} system your set has on — your own set is unchanged',
 'status.ready': 'Scene ready · {mb} MB · {n} chunk',
 'status.all': 'Whole body loaded · {n} chunk',
 'panel.structures': '{n} structure',
 'ask.context': 'Included: {n} structure and this scene link',
 // L31 v2.1b+c, S2 — the audit of the palette's two `{n}` rows, in full (RC13 again):
 //   `search.results` — "{n} of {total}" → "1 of 3,432" is already correct English. NOT listed, on
 //                      the same principle `rail.more` is not: a singular with no defect behind it
 //                      is a change, and `{total}` would need one too the day a lane holds one item.
 //   `search.capped`  — "the first {n} in each group" → `{n}` is the CAP constant (50). It is never
 //                      1 by construction, so a singular would be unreachable copy.
 // No other S2 row interpolates a count: `search.add` takes {name}, the lane names are bare.
 // L31 v2.1b+c, S3 — the audit of the tree's `{n}`/count rows, in full (RC13 again):
 //   `tree.sessionHidden` — "{n} structures hidden" → one hidden structure is the COMMON case, so
 //                           it needs a singular. Listed below.
 //   `tree.inventory` / `tree.filtered` — interpolate `{s}`/`{c}`/`{sn}`/`{cn}`, NOT `{n}`, so
 //                           `v2t`'s singular rule (which keys on `n`) cannot reach them anyway.
 //                           Deliberate: "1 of 15 systems · 1 of 3,432 structures" is correct
 //                           English as written, and a per-placeholder plural would need four
 //                           singulars and a rule that does not exist. Recorded rather than fixed.
 //   `tree.covered` / `tree.tickOn` / `tree.tickOff` / `tree.expand` / `tree.collapse` — {name},
 //                           not counts. No singular.
 'tree.sessionHidden': '{n} structure hidden for this session only',
 //   `refusal.unchanged` — "Your {n} structures are unchanged" → one structure is reachable (a
 //                         one-structure scene refusing a bulk add). Needed.
 //   `refusal.limit`     — FIXED codec constants, no placeholder. Nothing to plural.
 'refusal.unchanged': 'Your {n} structure is unchanged.',
 // L31 v2.1b+c, S4 — the audit of this group's `{n}`/count rows, in full (RC13 again):
 //   `about.pinyin`            — "{n} in all" → `{n}` is the size of the shipped map (5,681). It is
 //                               never 1 by construction (the atlas has 3,432 concepts alone), so a
 //                               singular would be unreachable copy. NOT listed, on purpose.
 //   `refusal.limitStructures` — "{n} structures" → `{n}` is strictly GREATER than the bound (>24)
 //                               or the refusal would not have fired. Unreachable singular.
 //   `refusal.encoded` / `refusal.linkEncoded` — "{n} characters" → same, >1,400.
 //   `refusal.addFull`         — `{max}`, a constant, not a count of anything the reader has.
 //   `about.runtimeList`       — `{deps}`, a rendered list. Not a count.
 // So S4 adds NO row here, and the reason is recorded rather than the absence being left to look
 // like an oversight.
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

/**
 * A CONTROLLER REFUSAL, IN THE READER'S LANGUAGE (L31 v2.1b+c, S4).
 *
 * The ONE place a `Reason` becomes words. Every surface that draws a refusal — the studio's
 * `.v2-refusal` card, the phone's `.v2-refused` line, the Find palette's banner — calls this, so
 * there is no second renderer that could translate differently or forget to.
 *
 * `detail` is returned SEPARATELY rather than concatenated, because the two have different
 * standing: the sentence is translated copy, the detail is `validateScene`'s own English and is
 * labelled as such where it is drawn. A caller that ignores `detail` loses precision, never
 * correctness — which is the right failure mode for a surface with no room for it.
 */
export function reasonText(lang: Lang, r: Reason): {text: string; detail?: string} {
 return {text: v2t(lang, r.key, r.vars), detail: r.detail};
}
