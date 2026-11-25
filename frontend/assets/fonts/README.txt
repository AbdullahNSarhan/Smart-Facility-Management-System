LCI-SFM Offline Typography Policy
=================================
LCI-SFM intentionally uses native OS UI and technical monospace font stacks:
  - Sans-serif UI: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
  - Technical Monospace: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace

Zero Google Fonts or remote webfont requests are issued at build time or runtime,
satisfying `font-src 'self'` under strict air-gapped Content Security Policy.
If custom `.woff2` fonts are added in future releases, store them in this directory
alongside their SIL OFL / Apache-2.0 license notice in `../licenses/`.
