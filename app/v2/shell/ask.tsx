/**
 * ══ THE ASK SURFACE — S5b. ONE COMPONENT, TWO HOSTS ═══════════════════════════════════════════
 *
 * The desktop dock (`.v2-pane`) and the phone's A8 sheet render THIS, not two implementations of
 * it. S5a shipped the hand-off twice — once in `Shell`, once in `PhoneSheets` — and the two were
 * already drifting (one used `copyText`, the other called the clipboard directly). Adding a chat
 * to both copies would have doubled the only security-bearing surface in the increment, which is
 * the one place in this app where "two implementations" is not a tidiness argument.
 *
 * ── THE TWO STATES ─────────────────────────────────────────────────────────────────────────────
 *
 *   NO KEY  — exactly what S5a shipped: a prompt box, "Ask in ChatGPT", "Copy prompt". Byte for
 *             byte the same behaviour, because the chat is OPTIONAL and the default must not move.
 *   A KEY   — the same box becomes a conversation. "Ask in ChatGPT" STAYS (RC11), because a reader
 *             who wants the full ChatGPT session should not have to delete their key to get it.
 *
 * ── WHAT THIS FILE MAY NOT DO (RC11 / opus-plan-review-2.md §G) ────────────────────────────────
 *
 *   · It may not read the key. It calls `hasOpenAi()` and `readOpenAiModel()`; the secret is read
 *     inside `ai.ts`'s request function and is never in this component's state, props or refs. A
 *     unit test asserts `readOpenAi` appears in no file but `store.ts` and `ai.ts`.
 *   · It may not produce HTML. The reply is rendered through `linkify`, which returns SEGMENTS for
 *     React to render as elements — there is no string of markup anywhere in this file, so there is
 *     nothing for a future `innerHTML` to be reached from.
 *   · It may not apply a proposed scene by itself. A `` ```scene `` block becomes a CARD with a
 *     diff and a button; the button routes through the page's `dispatch`, which is the same atomic
 *     refusal a shared link goes through. Nothing here validates a scene — that would be a second
 *     opinion about the controller's own question (the S5a JSON dock's rule, same reasoning).
 *   · It may not retry. One press, one request, one answer. An automatic retry on a browser-held
 *     key is an unbounded bill with nobody watching it.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import type {Scene} from '../../scene-model';
import type {Command} from '../controller';
import {AiError, ask, linkify, modelOf, proposedScene, sceneDiff, systemMessage, withoutSceneBlock} from './ai.ts';
import {hasOpenAi, readOpenAiModel} from './store.ts';

/** Broadcast by the Settings › AI panel when the key is saved or removed, so an OPEN dock changes
 *  state without a reload. The dock cannot poll `localStorage` (a render-time read would not
 *  re-run) and a shared React state would put the two surfaces back in one hook list. */
export const OPENAI_CHANGED = 'atlas-openai-changed';

interface Turn {role: 'user' | 'assistant'; text: string}

export interface AskProps {
  tr(k: string, v?: Record<string, string | number>): string;
  lang: string;
  scene: Scene | null;
  sceneBlob: string;
  picks: string[];
  /** The resolved selection, with the name the READER sees and the English one, for the context. */
  basket: {id: string; name: string}[];
  /** The UI-language name and the English name for a structure — `t.name` / the raw atlas name. */
  nameOf(id: string, fallback: string): string;
  dispatch(cmd: Command): boolean;
  /** The codec's own caption bounds, threaded rather than imported so this file stays UI-only. */
  titleMax: number;
  noteMax: number;
  /** Phone sheet vs desktop dock — a class name, not a second behaviour. */
  sheet?: boolean;
}

export default function AskPanel(p: AskProps) {
  const {tr} = p;
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{key: string; status: number | null; detail: string} | null>(null);
  const [spend, setSpend] = useState({r: 0, prompt: 0, completion: 0});
  const [applied, setApplied] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * ⚠️ THE PRESENCE OF A KEY IS STATE, THE KEY IS NOT. `hasOpenAi()` is a boolean; re-read on the
   * Settings panel's event so saving a key turns this dock into a chat without a reload.
   */
  const [keyed, setKeyed] = useState(() => hasOpenAi());
  useEffect(() => {
    const on = () => setKeyed(hasOpenAi());
    window.addEventListener(OPENAI_CHANGED, on);
    // `storage` fires for OTHER tabs: removing the key in one tab must disarm the chat in the next.
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(OPENAI_CHANGED, on); window.removeEventListener('storage', on); };
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  // A send in flight when the dock closes must not keep streaming into a dead component.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * ⚠️ FOLLOW THE ANSWER DOWN — and this is not a nicety, it is the difference between a control
   * being reachable and not. LOOKED AT, in the 1440 and 390 screenshots: the log is a bounded
   * scroller, so a reply long enough to overflow it left the PROPOSAL CARD cut off mid-word with
   * its "Apply to view" button entirely below the fold of a nested scroll area most readers would
   * not think to scroll. The one thing in this panel with a consequence was the one thing you
   * could not see.
   *
   * On every turn change AND every delta, the log is pinned to its bottom. `scrollTop = scrollHeight`
   * rather than `scrollIntoView`, which would also scroll the PAGE (and on the phone, the sheet)
   * out from under the reader.
   */
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  /** The S5a hand-off, unchanged: the controller's blob, so the link carries this session's edits. */
  const link = () =>
    `${location.origin}${location.pathname}${p.sceneBlob ? `?scene=${p.sceneBlob}` : `?select=${p.picks.join(',')}`}`;
  const promptText = (question: string) => `${question}\n\n${link()}`;
  const chatGptHref = (question: string) => `https://chatgpt.com/?q=${encodeURIComponent(promptText(question))}`;

  const send = useCallback(async () => {
    const question = q.trim();
    if (!question || busy) return;
    setErr(null);
    setApplied(null);
    setQ('');
    const history: Turn[] = [...turns, {role: 'user', text: question}];
    setTurns([...history, {role: 'assistant', text: ''}]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // BUILT FROM THE CONTROLLER (RC11 §G.6): the scene, the blob and the selection all come from
      // the page's own state, never from `location`. `link()` reads `location` for the ORIGIN only.
      const sys = systemMessage({
        lang: p.lang,
        scene: p.scene,
        blob: p.sceneBlob,
        link: link(),
        structures: p.basket.map((b) => ({id: b.id, shown: p.nameOf(b.id, b.name), english: b.name})),
        titleMax: p.titleMax,
        noteMax: p.noteMax,
      });
      const out = await ask({
        model: modelOf(readOpenAiModel()),
        messages: [{role: 'system', content: sys}, ...history.map((h) => ({role: h.role, content: h.text}))],
        signal: ac.signal,
        onDelta: (d) => setTurns((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = {role: 'assistant', text: last.text + d};
          return copy;
        }),
      });
      const used = out.usage;
      if (used) setSpend((s) => ({r: s.r + 1, prompt: s.prompt + used.prompt, completion: s.completion + used.completion}));
    } catch (e) {
      // An abort is the READER pressing Stop, not a failure — saying "the request did not reach
      // OpenAI" for something they asked for is the kind of message that teaches distrust.
      if (ac.signal.aborted) setErr({key: 'ai.stopped', status: null, detail: ''});
      else if (e instanceof AiError) setErr({key: e.key, status: e.status, detail: e.detail});
      else setErr({key: 'ai.failed', status: null, detail: ''});
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [q, busy, turns, p]);

  // ── rendering a reply: SEGMENTS, never markup ───────────────────────────────────────────────
  const body = (text: string) => linkify(withoutSceneBlock(text)).map((s, i) => (
    s.t === 'link'
      // `rel` and `target` on every model-authored link, and `linkify` emits `https:` only — there
      // is no allowlist here to get inverted, because the pattern cannot match anything else.
      ? <a key={i} href={s.v} target="_blank" rel="noopener noreferrer">{s.v}</a>
      : <span key={i}>{s.v}</span>
  ));

  /** The proposal card for one assistant turn, or nothing. */
  const proposal = (turn: Turn, i: number) => {
    if (turn.role !== 'assistant' || busy) return null;
    const parsed = proposedScene(turn.text);
    if (!parsed) return null;
    const d = sceneDiff(p.scene, parsed);
    return <div className="v2-ai-prop">
      <b>{tr('ai.proposal')}</b>
      <p className="v2-note-sm">
        {d.added.length ? tr('ai.adds', {n: d.added.length}) : ''}
        {d.added.length && d.removed.length ? ' · ' : ''}
        {d.removed.length ? tr('ai.drops', {n: d.removed.length}) : ''}
        {!d.added.length && !d.removed.length ? tr('ai.same') : ''}
      </p>
      <p className="v2-note-sm">{tr('ai.applyNote')}</p>
      <div className="v2-ai-propfoot">
        <button type="button" className="v2-tbtn is-on"
          onClick={() => { if (p.dispatch({type: 'apply-scene', scene: parsed as Scene})) setApplied(i); }}>
          {tr('ai.apply')}
        </button>
        {applied === i && <span className="v2-static">{tr('ai.applied')}</span>}
      </div>
    </div>;
  };

  const askBox = <>
    <textarea className="v2-askbox" value={q} aria-label={tr('panel.ask')}
      onChange={(e) => { setQ(e.target.value); setCopied(false); }}
      placeholder={tr('ask.placeholder')}
      // Enter sends, Shift+Enter is a newline — but only when there IS a key, because without one
      // there is nothing for Enter to do and a textarea that eats Enter would be broken.
      onKeyDown={(e) => {
        if (!keyed || e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        void send();
      }}/>
  </>;

  const handOff = <>
    <a className={`v2-tbtn ${q.trim() ? 'is-on' : ''}`} href={q.trim() ? chatGptHref(q.trim()) : undefined}
      target="_blank" rel="noreferrer noopener" aria-disabled={!q.trim()}
      style={q.trim() ? undefined : {opacity: .45, pointerEvents: 'none'}}>{tr('ask.open')}</a>
    <button type="button" className="v2-tbtn" disabled={!q.trim()}
      onClick={() => { void navigator.clipboard?.writeText(promptText(q.trim())).then(() => setCopied(true)).catch(() => {}); }}>
      {tr('ask.copy')}</button>
    {copied && <span className="v2-static">{tr('ask.copied')}</span>}
  </>;

  return <>
    <div className={p.sheet ? 'v2-ai-sheetbody' : 'v2-pane-body'}>
      <p className="v2-note-sm"><b>{tr('ask.lead')}</b></p>
      {keyed && turns.length === 0 && <p className="v2-note-sm">{tr('ai.empty')}</p>}
      {keyed && turns.length > 0 && <div className="v2-ai-log" ref={logRef} role="log" aria-live="polite">
        {turns.map((t, i) => <div key={i} className={`v2-ai-turn is-${t.role}`}>
          <b>{tr(t.role === 'user' ? 'ai.you' : 'ai.answer')}</b>
          <div className="v2-ai-text">{t.role === 'user' ? t.text : body(t.text)}</div>
          {t.role === 'assistant' && !t.text && busy && <span className="v2-static">{tr('ai.waiting')}</span>}
          {proposal(t, i)}
        </div>)}
      </div>}
      {/* KEYED, so it is the reader's language — and the DETAIL is quoted separately and marked
          `lang="en"`, exactly as the JSON dock quotes an engine message (S5a). `ai.ts` has already
          stripped any `sk-` run from it. */}
      {err && <p className="v2-json-err" role="alert">
        {tr(err.key, err.status === null ? undefined : {n: err.status})}
        {err.detail && <span className="v2-refusal-detail"><b>{tr('refusal.detail')}:</b> <span lang="en">{err.detail}</span></span>}
      </p>}
      {askBox}
      <p className="v2-note-sm" style={{marginTop: 10}}>{tr('ask.context', {n: p.basket.length})}</p>
      <p className="v2-note-sm">{keyed ? tr('ai.keyNote') : tr('ask.note')}</p>
      {keyed && spend.r > 0 && <p className="v2-note-sm">
        <b>{tr('ai.spendTitle')}:</b> {tr('ai.spend', {r: spend.r, p: spend.prompt, c: spend.completion})}
      </p>}
    </div>
    <div className={p.sheet ? 'v2-sheet-foot' : 'v2-pane-foot'}>
      {keyed && (busy
        ? <button type="button" className="v2-tbtn" onClick={() => abortRef.current?.abort()}>{tr('ai.stop')}</button>
        : <button type="button" className="v2-tbtn is-on" disabled={!q.trim()} onClick={() => void send()}>{tr('ai.ask')}</button>)}
      {/* RC11: "Ask in ChatGPT stays available with a key too." */}
      {handOff}
      {keyed && turns.length > 0 && !busy && <>
        <span className="v2-grow"/>
        <button type="button" className="v2-tbtn" onClick={() => { setTurns([]); setErr(null); setApplied(null); }}>{tr('ai.clear')}</button>
      </>}
    </div>
  </>;
}
