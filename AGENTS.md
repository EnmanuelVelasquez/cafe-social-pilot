<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

- Business rules (thresholds, ratios, validation math) live as pure functions in
  `src/lib/` with a colocated test in `src/test/` — never inline in a route file,
  so the rule stays assertable and shared. Why: routes get rewritten often and the
  numbers must not drift.
- New colors are added as semantic tokens in `src/styles.css` and consumed through
  a component variant; components never carry a raw hex value. Why: hardcoded
  colors bypass theming and break dark mode.
