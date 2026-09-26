# Simplified workspace — 2026-09-26

Root page now loads only workspace.css/workspace.mjs. Two visible panels: video/event navigation and inline human review. Old navigation, reports, metrics, experiments, demo menus and local-engine iframe are no longer mounted. Historical data and legacy source files remain for recovery; prior browser storage is not deleted.

Supported: local video selection, matching saved benchmark validation by size/duration (not cryptographic video identity), JSON/JSONL event or alignment report import, click-to-seek candidates, explicitly labelled boundary/review windows, manual range/description confirmation, rejection, revert, add missed event, browser persistence and export/reimport.

A raw event table with only game clock does not automatically become video timestamps. Such rows can be manually located here; the local analysis code is retained but not exposed as another main-page module. Review data is separate from original candidates. Saves require working localStorage and confirmation requires valid ranges inside the loaded video. Source gaps are not claimed recovered.

Regression: node tools/test_simple_workspace.mjs [--live] from the parent workspace. Uses disposable browser storage; tests do not alter user annotations.
