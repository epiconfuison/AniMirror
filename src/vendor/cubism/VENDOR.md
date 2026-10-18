# Vendored Live2D Cubism SDK for Web

- SDK revision: `5-r.5` (package directory `CubismSdkForWeb-5-r.5`)
- Upstream Core commit: `d96fa37f45ab8448936200c16a090ca9c2dc2945`
- Upstream Framework commit: `a49bc546222194ac28326d20a46aa35ee4d1ce8e`
- Framework sources: `framework/` (copied from the SDK, prefixed with `@ts-nocheck`)
- Cubism Core: `core/live2dcubismcore.min.js`, also published at `/vendor/live2dcubismcore.min.js` and loaded as a classic script.

## Licences

- Cubism Core: Live2D Proprietary Software License Agreement. Redistribution is limited to the files listed in `core/RedistributableFiles.txt`.
- Cubism Web Framework and the included shaders: Live2D Open Software License Agreement. The sources stay inside this application; they are not published as a standalone SDK.
- Models are licensed separately by their authors. This repository ships no Live2D model.

Regenerate with `pnpm live2d:setup` (see `scripts/setup-live2d.mjs`); `scripts/live2d-sdk.lock.json` records every file hash.
