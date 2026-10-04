# Code signing and notarization plan (#206)

The installers built by `.github/workflows/release.yml` are **unsigned**. That works, but Windows SmartScreen and macOS Gatekeeper warn the player on first run. This is the plan for signing them. It needs accounts and money that only the owner can arrange, so nothing here is switched on yet.

Steam builds (`npm run dist:steam`) are a separate case: SteamPipe delivers the files, so players do not meet SmartScreen or Gatekeeper warnings from a browser download. Signing the Windows `.exe` is still worth doing, because it cuts false positives from antivirus tools.

## What to buy or enrol in

| Platform | What you need | Notes |
| --- | --- | --- |
| Windows | A code-signing certificate (OV or EV) from a certificate authority, or a cloud signing service such as Azure Trusted Signing | EV certificates and cloud signing build SmartScreen reputation fastest. A plain OV certificate still shows a warning until enough people have installed the app. Certificates are often tied to a hardware token or a cloud HSM, which affects how CI can use them. |
| macOS | An Apple Developer Program membership, then a **Developer ID Application** certificate | Required for both signing and notarization. |
| Linux | Nothing | AppImage and `.deb` are not signed by electron-builder. Publish the SHA-256 sums next to the release if you want players to verify downloads. |

## Secrets to add in GitHub (Settings → Secrets and variables → Actions)

| Secret | Used for |
| --- | --- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | The Windows certificate (a base64-encoded `.pfx`, or a URL) and its password. Not needed with a cloud service that signs through its own action. |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | The Developer ID Application certificate exported as a `.p12`, base64-encoded, and its password. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization. The password is an *app-specific* password made at appleid.apple.com, never the account password. |

electron-builder reads `CSC_LINK` and `CSC_KEY_PASSWORD`, and the two platforms need different certificates, so the workflow maps the right pair per runner.

## Changes to make when the accounts exist

1. **Workflow environment.** In the "Unsigned builds" `npm run dist` step of `release.yml`, drop `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` for tag builds and add, per runner:

   ```yaml
   env:
     CSC_LINK: ${{ matrix.os == 'windows-latest' && secrets.WIN_CSC_LINK || matrix.os == 'macos-latest' && secrets.MAC_CSC_LINK || '' }}
     CSC_KEY_PASSWORD: ${{ matrix.os == 'windows-latest' && secrets.WIN_CSC_KEY_PASSWORD || matrix.os == 'macos-latest' && secrets.MAC_CSC_KEY_PASSWORD || '' }}
     APPLE_ID: ${{ secrets.APPLE_ID }}
     APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
     APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
   ```

   Keep `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` on pull-request builds, which have no access to secrets, so they stay unsigned and still pass.

2. **macOS notarization.** In the `mac` block of `package.json` set `"hardenedRuntime": true` (electron-builder's default) and `"notarize": true`, and add an entitlements file if Chromium needs extra rights (JIT is the usual one). electron-builder then signs, submits to Apple and staples the ticket.
3. **Windows.** electron-builder signs the NSIS installer and the app executable from `CSC_LINK`. With a cloud service, add its signing action after the build, or set the `win.azureSignOptions` block that electron-builder supports for it.
4. **Verify in CI.** After the build, check each artifact: `codesign --verify --deep --strict` and `spctl --assess` on the macOS app, and `Get-AuthenticodeSignature` on the Windows `.exe`. Fail the job if either is unsigned on a tag build.
5. **Only sign tag builds.** Pull requests and `workflow_dispatch` runs keep producing unsigned artifacts, so a stolen or mis-set secret cannot leak through an untrusted PR.

## Order of work

1. Enrol in the Apple Developer Program (the longest wait) and choose a Windows signing option.
2. Do a manual signed build on a local machine to confirm the certificates work.
3. Add the secrets and make the workflow changes above on a branch, then push a throwaway tag such as `v0.0.0-test` to check the signed release end to end. Delete the draft release afterwards.
4. Update the README "Desktop app" section and remove the "unsigned" warning.
