# Agent Loop Cleanup Notes

These areas were left in place for now because they may still be useful, but they should be reviewed before adding more logic.

## Likely duplication or legacy

- `src/main/browser/BrowserTaskMemory.ts`
  Browser-specific memory still exists alongside the newer unified task memory store. Keep it for tab/snapshot-specific bookkeeping for now, but evaluate whether its findings and snapshot tracking should collapse into the unified task memory path.

- `src/main/models/contextManager.ts`
  Handoff packets still duplicate some summary/artifact information that now also lands in task memory. Review whether handoff history should become a typed view over task memory instead of a parallel store.

- `src/main/browser/BrowserService.ts`
  Search extraction, page evidence extraction, comparison, and synthesis now coexist in one service. This is acceptable short-term, but longer-term evidence extraction and synthesis may belong in a smaller research-oriented module instead of the general browser runtime.

- `src/main/models/tools/toolDefinitions.ts`
  Tool inventory is growing quickly. Review whether browser-research tools, browser-observation tools, and general task-memory tools should be grouped into separate files to avoid schema bloat.

## Probably outdated assumptions to verify

- Static result-ranking heuristics in `extractSearchResults`
  They work for now, but may be outdated relative to stronger model-led tab selection flows.

- Browser surface taxonomy breadth
  `feed | panel | section | modal | drawer | form | unknown` may be too product-specific if the system shifts toward claim/evidence verification instead of UI-state tuning.

- Handoff-centric context flow
  The app still assumes provider handoff packets are a primary context primitive. Verify whether compact structured task memory should replace most of that path.
