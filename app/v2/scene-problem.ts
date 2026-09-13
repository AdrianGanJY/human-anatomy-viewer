/**
 * THE CODEC'S KEYED REFUSAL, AS A TYPE — L31 v2.1b+c, S6.
 *
 * `app/scene-codec.js` is JavaScript (it runs in the Worker and in `functions/mcp.js`, neither of
 * which compiles TypeScript), so the shape `sceneProblem` returns needs a declaration somewhere for
 * the UI to type against.
 *
 * ⚠️ IT LIVES IN ITS OWN FILE FOR A REASON THAT IS NOT TIDINESS. `test/v2-copy-reasons.test.mjs`
 * scans `controller.ts` for every refusal key it emits, and its fallback lexer — the one that runs
 * where TypeScript is absent — cannot tell a `key: string` in a TYPE ANNOTATION from a `key:` in an
 * object literal. Declaring this interface inside controller.ts made the lexer report an
 * "uncheckable computed key" that the compiler's AST correctly ignored, i.e. it broke the guard
 * that proves the two scanners agree. Moving the declaration out is cheaper than teaching a
 * hand-written lexer about type positions, and it keeps controller.ts free of any `key:` token that
 * is not a real emission.
 */
export interface SceneProblem {
  key: string;
  vars?: Record<string, string | number>;
}
