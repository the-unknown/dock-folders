# Dock Folders

Group apps into folders in [Dash to Dock](https://github.com/micheleg/dash-to-dock), like on Android.

> Requires **GNOME Shell 48** and **Dash to Dock** (enabled). This extension hooks into Dash to Dock's
> internals, so a Dash to Dock update can break it.

## Features

- Folders show up in the dock as one icon with a 2×2 preview of their apps.
- **Create a folder** by dragging one app icon onto the centre of another, or via right-click → *Add to folder* → *New folder …*.
- **Add apps** by dragging them onto a folder icon, or via the app's right-click menu.
- **Open a folder** with a click: rename it in the text field, launch apps, reorder them by drag & drop,
  remove an app with a right-click on its tile, or dissolve the folder.
- **Move folders** in the dock by dragging them before or after any other icon.

Apps inside a folder are hidden from the dock itself. Folders are stored in GSettings
(`org.gnome.shell.extensions.dock-folders`, key `folders`, JSON).

## Install

```sh
git clone https://github.com/the-unknown/dock-folders.git \
  ~/.local/share/gnome-shell/extensions/dock-folders@the-unknown.github.io
glib-compile-schemas ~/.local/share/gnome-shell/extensions/dock-folders@the-unknown.github.io/schemas
```

Log out and back in (Wayland), then:

```sh
gnome-extensions enable dock-folders@the-unknown.github.io
```

To build an installable zip: `gnome-extensions pack --force .`

## How it works

Dash to Dock is not modified. The extension wraps `DockDash._redisplay`: before the original runs, its folder
items are taken out of the dash box (Dash to Dock computes positions from the children); afterwards the
apps that live in folders are hidden and the folder items are inserted again. It also adds drag handlers
and a menu entry to Dash to Dock's app icons.

## Known limitations

- A running app inside a folder has no running indicator.
- Hidden apps still count towards Dash to Dock's icon-size calculation.
- Apps cannot be dragged out of the folder popup back to the dock (use right-click → remove).

## License

GPL-2.0-or-later
