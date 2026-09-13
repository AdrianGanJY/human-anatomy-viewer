/**
 * ONE RENDERER FOR A CONTROLLER REFUSAL — L31 v2.1b+c, S4.
 *
 * Three surfaces draw a refusal: the studio's `.v2-refusal` card (shell.tsx), the phone's
 * `.v2-refused` line (page.tsx) and the Find palette's banner (find.tsx). Before S4 each of them
 * printed the controller's raw string, which is how one English sentence came to sit inside three
 * translated frames. Giving them a shared component rather than a shared *rule* is the difference
 * between a fix and a convention: there is no second place that could forget the detail label, or
 * translate the sentence and not mark the English.
 *
 * ⚠️ THE `lang="en"` IS GONE, AND ITS ABSENCE IS THE POINT (S6). It was right while every detail
 * came from `validateScene` as English — a screen reader in a Chinese interface should switch voice
 * for "unknown emphasis" rather than attempt Mandarin phonetics on it. Since S6 the codec's
 * refusals arrive KEYED (`r.problem`) and resolve into the reader's language, so keeping the
 * attribute would tell the screen reader to read Chinese in an English voice: the same defect,
 * mirrored. The one genuinely English producer left — `JSON.parse`'s engine message — is not a
 * `Reason` and is rendered by the Scene JSON dock, which still marks it.
 */
import {reasonText, v2t} from './copy';
import type {Reason} from './controller';
import type {Lang} from '../i18n/ui';

export default function RefusalText({lang, r}: {lang: Lang; r: Reason}) {
 const {text, detail} = reasonText(lang, r);
 return <>
  {text}
  {detail && <span className="v2-refusal-detail">
   <b>{v2t(lang, 'refusal.detail')}:</b> <span>{detail}</span>
  </span>}
 </>;
}
