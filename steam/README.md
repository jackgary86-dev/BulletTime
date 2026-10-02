# Shipping BulletTime on Steam

The Steam build is the desktop app (Electron, see the main README) unpacked into a folder per OS, uploaded with SteamPipe. Nothing here needs Steamworks code: BulletTime doesn't use achievements or the Steam API.

## 1. Build the depot content

On each OS you ship (or take the `steam-Windows`, `steam-macOS` and `steam-Linux` artifacts from the **Desktop installers** workflow, which runs on every `v*` tag):

```sh
npm ci
npm run dist:steam   # → release/steam/windows, release/steam/mac or release/steam/linux
```

Each folder is exactly what lands in the player's Steam install folder: the `BulletTime` executable (`BulletTime.exe` on Windows, `BulletTime.app` on macOS) plus Electron's and Chromium's license files. Put the three folders side by side under `release/steam/`.

When Steam launches the game it sets `SteamAppId`, and the app switches the GPU into the main process so the Steam overlay (Shift+Tab) can draw over it.

## 2. Steamworks setup (your account)

1. Join Steamworks as a partner and pay the Steam Direct fee for an App ID.
2. **App Admin → Installation → General**: add launch options. Windows: executable `BulletTime.exe`. macOS: `BulletTime.app`. Linux: `BulletTime`. One per OS.
3. **SteamPipe → Depots**: create one depot per OS and set each depot's operating system.
4. Put your App ID and depot IDs into `app_build.vdf` and the three `depot_build_*.vdf` files here, replacing `1000000`–`1000003`.
5. **Store page → Mature content survey**: tick *Frequent violence or gore* (simulated blood on human-shaped targets) and mention the optional reduced-gore setting and the in-game content warning.
6. Set the price, release date and store assets (capsule images, screenshots, trailer).

## 3. Upload

With the [Steamworks SDK](https://partner.steamgames.com/doc/sdk) `steamcmd` (from `sdk/tools/ContentBuilder/builder*`):

```sh
steamcmd +login <your_steam_account> +run_app_build "$(pwd)/steam/app_build.vdf" +quit
```

`SetLive` is empty, so the build only appears under **SteamPipe → Builds**; set it live on the `default` branch (or a beta branch first) from there.
