# Mac companion

## User setup

1. Open the companion DMG and copy **Porch Companion** to Applications.
2. Open the app. In Porch web settings, choose **Create pairing code**.
3. Enter the Porch HTTPS address and code in the companion. Codes expire in five minutes.
4. If Codex is missing or unsupported, choose **Install supported Codex**. This downloads the pinned official npm release, verifies SHA-512 integrity, checks its expected files, and installs it in the companion’s data folder. No terminal commands are needed.
5. Choose **Sign in** if needed. Complete the supported Codex browser flow, then choose **Check again**.
6. Enter a project label and choose its folder with the native picker. Select **Connect**.
7. In web settings, create your personal or shared bot and confirm the trust statement.
8. Mention that bot in a topic using the suggestions. Everyone in the workspace can direct it.

The companion runs from the menu bar. Closing its window does not stop it. **Stop & disconnect** requests interruption and disables new starts. Enable **Start at login** if this Mac should be available after sign-in.

## Repair

- **Missing folder:** choose **Repair folder…**, select its new location, then reconnect.
- **Missing or incompatible Codex:** install the pinned runtime or select its executable. Common GUI installation locations and the process PATH are checked. An explicit selection is never silently replaced.
- **Expired sign-in:** complete Codex sign-in in the browser and check again.
- **Lost local session:** choose **Start fresh** in the web topic. The old session is never replaced silently.
- **Uncertain work:** inspect the project, then use explicit retry or start fresh. A retry can repeat side effects that the host could not confirm.
- **Revoked Mac:** create a new pairing. Revoke abandoned hosts in web settings.
- **Corrupt settings/journal:** restore the companion data before running more work. Do not delete the journal to make an uncertain run look new.

## Storage

Settings and the synced dispatch journal live under `~/Library/Application Support/Porch Companion` in packaged builds. Host credentials live in macOS Keychain under service `com.porch.companion.host`. They are passed to Keychain on stdin, not process arguments. Provider credentials remain in Codex’s own storage. Journal context contains only the eligible topic projection.

## Build and distribution

```sh
npm run companion:build
npm run companion
npm run companion:package
```

The default packaging target is Apple Silicon (`arm64`). To build for Intel, run electron-builder with `--mac --x64` after the companion build. Intel source paths are implemented but were not tested on Intel hardware.

For public distribution, use a valid Apple **Developer ID Application** certificate and notarization credentials supported by electron-builder. Configure `CSC_LINK`/`CSC_KEY_PASSWORD` or an installed signing identity, and Apple API-key credentials or Apple ID/app-specific-password/team variables in your secure build environment. Never commit those credentials. Verify the resulting app with `codesign` and Gatekeeper and confirm notarization before publishing.

The local artifact is **unsigned and not notarized** because a valid Developer ID identity was unavailable. Do not market security-warning workarounds as finished onboarding. The native folder-picker check also requires an unlocked Mac; see the current limitations report for its actual verification status.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [electron-builder macOS signing](https://www.electron.build/code-signing-mac.html), [Codex app-server](https://learn.chatgpt.com/docs/app-server).
