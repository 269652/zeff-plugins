# Correlations

Zeff's Correlations as a plugin: what goes with what in your days. A journal's energy or mood is set against meeting hours, booked
hours, messages, todos, spending and your other fields, for the same day and the day after.

- **The numbers are the built-in's own.** `lambdas/_lib.mjs` is generated from the built-in Correlations' pure core by Zeff's
  `scripts/port-correlations.mts`: Spearman and Pearson, group comparisons, a permutation test with Benjamini–Hochberg, and the same
  sentences in German and Spanish. Don't change it here; change the core in Zeff and generate it again.
- **The data is Zeff's.** The daily series come from the kernel (`series.read`), only those you may see: your databases' fields and
  Zeff's own signals.
- Brings the `correlations` tool for agents and the *Correlations* widget. Everything runs as lambdas, no Notebook needed.
