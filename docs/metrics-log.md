# Weekly metrics log

Running log for the success metrics in [marketing-plan.md §10](marketing-plan.md#10-success-metrics).
Every number comes from a public registry API or the Polar.sh dashboard. The extension has no
telemetry and never will just to fill this table.

## Weekly pull (about 10 minutes)

1. Read the paying-customer count off the Polar.sh dashboard.
2. Run the pull. It fetches Open VSX, VS Marketplace, and GitHub, works out the change since the
   last row, and appends the new row to the table below:

   ```sh
   node scripts/pull-metrics.cjs --pro <polar-customers> --append
   ```

   Leave out `--append` to print the row without writing it. Leave out `--pro` and that cell stays
   `?` for you to fill in. Add `--note "text"` for anything that explains a jump, such as a release
   or a post.
3. Commit `docs/metrics-log.md`.

## How to read the numbers

- Each cell is `cumulative (Δ since previous row)`. **Read the Δ.** The cumulative figure is only
  there so the next delta can be worked out.
- **Open VSX downloads include updates.** Every release pushes the count up for users who already
  have the extension, so this number overstates users. Do not quote it as an install count. A big
  delta in the week of a release is mostly existing users updating.
- **Marketplace installs** are the only unique-install figure either registry publishes.
  Marketplace downloads, like Open VSX downloads, include updates.
- **Pro customers** come from Polar.sh by hand. No API call, no telemetry.

## Log

| Date | Open VSX downloads | Marketplace installs | Marketplace downloads | GitHub stars | Open VSX reviews | Pro customers | Notes |
| :-- | --: | --: | --: | --: | --: | --: | :-- |
| 2026-09-08 | 5,334 (baseline) | 73 (baseline) | 567 (baseline) | 0 (baseline) | 0 (baseline) | 0 (baseline) | Baseline from marketing plan §1; v1.3.11 live |
