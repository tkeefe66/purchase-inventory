# Other — catchall domain

Items that don't match any registered domain classifier land here with `Domain=Other` in the sheet.

In v1 (Outdoor only) this catches everything that isn't outdoor. The Outdoor classifier runs first; whatever it rejects becomes Other.

This folder will hold no code until the router or reclassification logic needs it. Reclassifying old `Other` rows into a newly-shipped domain is a one-off `npm run reclassify` task scoped per domain — see `docs/PLAN.md` Phase 7.
