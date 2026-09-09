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
