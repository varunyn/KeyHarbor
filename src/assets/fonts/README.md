# Bundled interface fonts

Geist and JetBrains Mono regular, medium, and semibold are bundled for offline rendering of the project secrets workspace. Other screens retain their existing font stacks.

Source: Google Fonts (`fonts.gstatic.com`), downloaded October 2, 2026. Licenses are retained in `geist-OFL.txt` and `jetbrainsmono-OFL.txt`; both fonts use the SIL Open Font License 1.1.

Font declarations live in `src/styles/common.css`; the secrets screen selects the faces in `src/styles/project.css`. Vite copies referenced font files into packaged renderer assets.
