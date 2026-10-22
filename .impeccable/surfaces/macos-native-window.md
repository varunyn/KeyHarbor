# Surface brief — Native macOS window

Mode: Operate. Scope: the Mac desktop shell and navigation; preserve all vault operations and the Windows/Linux layout.

## Direction contract

THESIS: Make KeyHarbor feel at home on macOS through actual system materials and familiar window behavior.

OWN-WORLD: User-pinned native macOS conventions: unified title bar, system font, quiet blue controls, translucent navigation, and solid content. This is a platform adaptation of the existing workspace, implemented directly in code.

STORY: Unlock the local vault, choose a project and environment, inspect masked credentials, and deliberately choose an action. Every visible state derives from vault evidence.

FIRST VIEWPORT: A 48px title bar reserves room for real traffic lights. Translucent navigation sits beside a readable solid workspace. No new claim, dashboard metric, or fictional example is introduced.

FORM: Public AppKit NSGlassEffectView on macOS 26+, Electron sidebar vibrancy on older systems, opaque material for reduced transparency or increased contrast. Preserve native resizing and full screen; backdrop views do not handle input. Code-led adaptation; no image assets or concept comps.

SIGNATURE INTERACTION: The operating system provides the material; clicks and keyboard focus remain in the existing renderer, and secret values stay masked.

## Implementation constraint

Use the existing Tailwind and Radix component system. WindowChrome owns the reusable native shell and window utility classes. Platform colors and fonts are overrides of shared theme tokens; do not introduce a separate Mac stylesheet or duplicate control styling.

## Verification

Compile Apple Silicon and Intel bridges, check formatting/types/styles, run all tests, and inspect actual title bar, navigation, menus, modal import, both themes, and standard/fullscreen window modes. No production credentials are imported or revealed during verification.
