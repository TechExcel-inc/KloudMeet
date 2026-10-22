# macOS release (Kloud Meet desktop)

The packaged app runs a bundled Next.js server (`Contents/Resources/standalone`) with native
modules (Prisma query engine, sharp, nut-js). Those are architecture-specific, so **build each
architecture on a machine of that architecture** — an Intel Mac for `x64`, an Apple-silicon Mac
(or a macOS arm64 CI runner) for `arm64`. A `universal` build is not possible: the arm64 and x64
bundles contain different Mach-O files and `@electron/universal` refuses to merge them.

## One-time setup (per build machine)

1. **Developer ID Application** certificate (Apple Developer Program) imported into the login
   keychain. Check with `security find-identity -v -p codesigning`.
2. Notarization credentials as environment variables — either an App Store Connect API key
   (recommended):

   ```bash
   export APPLE_API_KEY=/path/to/AuthKey_XXXXXX.p8
   export APPLE_API_KEY_ID=XXXXXX
   export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

   or an Apple ID with an app-specific password: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
   `APPLE_TEAM_ID`. Never commit these.
3. A 1024×1024 `build/icon.png` (gitignored). Without it, `prepare-electron-app` upscales
   `public/images/kloud-meet-desktop-icon.png` as a stopgap.
4. **dmgbuild download**: `.npmrc` points Electron downloads at npmmirror, which does not host the
   dmg-builder bundle (404). Download it once from GitHub, verify, and point the build at it:

   ```bash
   ARCH=x86_64   # or arm64 on Apple silicon
   curl -fL -o dmgbuild.tgz "https://github.com/electron-userland/electron-builder-binaries/releases/download/dmg-builder@1.2.0/dmgbuild-bundle-${ARCH}-75c8a6c.tar.gz"
   shasum -a 256 dmgbuild.tgz   # x86_64: 87b3bb72…c4a4e2, arm64: a785f2a3…fc25e0 (full hashes in node_modules/dmg-builder/out/dmgUtil.js)
   mkdir -p ~/.kloud-dmgbuild && tar xzf dmgbuild.tgz -C ~/.kloud-dmgbuild
   export CUSTOM_DMGBUILD_PATH=~/.kloud-dmgbuild/dmgbuild
   ```

## Build

Build in a checkout that is **not** running `next dev` (the build rewrites `.next`).

```bash
NEXT_PUBLIC_REMOTE_API= npm run electron:dist:mac
```

Output in `dist/`: `Kloud Meet-<version>-<arch>.dmg`, `…-<arch>.zip`, blockmaps and
`latest-mac.yml`. Signing and notarization run automatically when the certificate and the
`APPLE_*` variables are present (`hardenedRuntime`, entitlements in
`electron/entitlements.mac.plist`, `notarize: true`). Verify:

```bash
codesign -dv --verbose=2 "dist/mac/Kloud Meet.app"
spctl -a -vvv -t install "dist/Kloud Meet-<version>-x64.dmg"
xcrun stapler validate "dist/Kloud Meet-<version>-x64.dmg"
```

## Publish

1. Build x64 and arm64 on their machines.
2. Merge the two `latest-mac.yml` files into one whose `files:` list contains **both** zips and
   both dmgs (electron-updater auto-updates from the zip matching the running architecture;
   `/api/download?os=mac&arch=arm64|x64` serves the matching dmg). Keep `path`/`sha512` pointing
   at the arm64 zip.
3. Upload all dmg/zip/blockmap files and the merged `latest-mac.yml` to
   `https://kloud.cn/kloudmeet-exe/` (same place as the Windows `latest.yml`).
4. Set `MAC_APP_AVAILABLE = true` in `lib/desktopRelease.ts` and `MAC_AVAILABLE = true` on the
   marketing site's `download.html`.

First launch on macOS asks for Camera, Microphone, Screen Recording (screen share and
annotation) and Accessibility (remote control) permissions.
