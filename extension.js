// SPDX-License-Identifier: GPL-2.0-or-later

// Dock Folders – Ordner für Dash to Dock.
//
// Hängt sich per Wrapper um DockDash._redisplay: vor dem Original werden die
// Ordner-Items aus der Dash-Box genommen (DtD berechnet Positionen anhand der
// Kinder), danach werden Ordner-Mitglieder ausgeblendet und die Ordner-Items
// wieder eingefügt. Dash to Dock selbst bleibt unverändert.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DTD_UUID = 'dash-to-dock@micxgx.gmail.com';
const GRID_COLUMNS = 3;
const EXTENSION_ENABLED = 1; // = ExtensionState.ENABLED

// Wird in _activate() aus Dash to Dock übernommen (Label-Positionierung)
let itemShowLabel = null;
let positionStyleClass = ['top', 'right', 'bottom', 'left'];

const FolderContainer = GObject.registerClass(
class AfdFolderContainer extends Dash.DashItemContainer {
    showLabel() {
        if (itemShowLabel)
            return itemShowLabel.call(this);
        return super.showLabel();
    }
});

class FolderItem {
    constructor(ext, dash, folder) {
        this._ext = ext;
        this._dash = dash;
        this._signature = null;
        this.id = folder.id;

        this.actor = new FolderContainer();
        this.actor.label?.add_style_class_name(positionStyleClass[dash._position]);

        this._button = new St.Button({
            style_class: 'overview-tile',
            can_focus: true,
            reactive: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });
        this._tile = new St.Widget({
            style_class: 'overview-icon afd-folder-tile',
            layout_manager: new Clutter.GridLayout({
                column_homogeneous: true,
                row_homogeneous: true,
            }),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.set_child(this._tile);
        this.actor.setChild(this._button);

        // Drop-Ziel für Apps, die aus der Dock gezogen werden
        this.actor._delegate = this;
        this._button._delegate = this;

        this._button.connect('clicked', () => this._toggleMenu());

        // Ordner lassen sich in der Dock verschieben
        this.isFolder = true;
        this._draggable = DND.makeDraggable(this._button, {timeoutThreshold: 200});
        this._draggable.connect('drag-begin', () => {
            this._menu.close(false);
            this.actor.opacity = 50;
        });
        this._draggable.connect('drag-end', () => {
            this.actor.opacity = 255;
        });

        this._menu = new PopupMenu.PopupMenu(this._button, 0.5, dash._position);
        this._menu.blockSourceEvents = true;
        this._menu.actor.add_style_class_name('app-menu');
        this._menu.actor.add_style_class_name('afd-popup');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this._button);
        this._menuManager.addMenu(this._menu);
        this._menu.connect('open-state-changed', (_menu, open) => {
            this._dash._itemMenuStateChanged(this.actor, open);
        });

        this.actor.connect('destroy', () => {
            this._menu.destroy();
            this._menu = null;
        });
    }

    get folder() {
        return this._ext.getFolder(this.id);
    }

    update(folder, iconSize) {
        const signature = JSON.stringify([folder.name, folder.apps, iconSize]);
        if (signature === this._signature)
            return;
        this._signature = signature;

        this.actor.setLabelText(folder.name);

        const pad = Math.round(iconSize * 0.1);
        const mini = Math.floor((iconSize - 2 * pad) / 2) - 2;
        this._tile.style = `width: ${iconSize - 2 * pad}px; height: ${iconSize - 2 * pad}px; ` +
            `padding: ${pad}px;`;
        this._tile.destroy_all_children();

        const apps = this._ext.resolveApps(folder).slice(0, 4);
        apps.forEach((app, i) => {
            const icon = app.create_icon_texture(mini);
            icon.x_align = Clutter.ActorAlign.CENTER;
            icon.y_align = Clutter.ActorAlign.CENTER;
            this._tile.layout_manager.attach(icon, i % 2, Math.floor(i / 2), 1, 1);
        });

        if (this._menu?.isOpen)
            this._rebuildMenu();
    }

    _toggleMenu() {
        if (this._menu.isOpen) {
            this._menu.close(true);
            return;
        }
        this._rebuildMenu();
        this._menu.open(true);
    }

    _rebuildMenu() {
        const folder = this.folder;
        if (!folder) {
            this._menu.close(false);
            return;
        }
        this._menu.removeAll();

        // Name
        const nameItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const entry = new St.Entry({
            style_class: 'afd-entry',
            text: folder.name,
            can_focus: true,
            x_expand: true,
        });
        const commitName = () => this._ext.renameFolder(this.id, entry.get_text());
        entry.clutter_text.connect('activate', commitName);
        entry.clutter_text.connect('key-focus-out', commitName);
        nameItem.add_child(entry);
        this._menu.addMenuItem(nameItem);

        // App-Raster
        const gridItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const grid = new St.Widget({
            layout_manager: new Clutter.GridLayout(),
            x_expand: true,
        });
        this._ext.resolveApps(folder).forEach((app, i) => {
            const tile = new St.Button({
                style_class: 'afd-app',
                can_focus: true,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
                child: new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER}),
            });
            tile.child.add_child(app.create_icon_texture(48));
            tile.child.add_child(new St.Label({
                text: app.get_name(),
                style_class: 'afd-app-label',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            tile.connect('clicked', (_t, button) => {
                if (button === Clutter.BUTTON_SECONDARY) {
                    this._ext.removeFromFolder(app.get_id());
                } else {
                    this._menu.close(true);
                    app.activate();
                }
            });
            this._makeTileSortable(tile, folder.id, app.get_id());
            grid.layout_manager.attach(tile, i % GRID_COLUMNS, Math.floor(i / GRID_COLUMNS), 1, 1);
        });
        gridItem.add_child(grid);
        this._menu.addMenuItem(gridItem);

        // Fußzeile
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(
            'Rechtsklick auf App: aus Ordner entfernen'));
        const dissolve = new PopupMenu.PopupMenuItem('Ordner auflösen');
        dissolve.connect('activate', () => this._ext.dissolveFolder(this.id));
        this._menu.addMenuItem(dissolve);
    }

    // Apps im Popup per Drag & Drop umsortieren
    _makeTileSortable(tile, folderId, appId) {
        const ext = this._ext;
        const afterOf = (x, actor) => x > actor.width / 2;

        tile._delegate = {
            isFolderApp: true,
            folderId,
            appId,
            getDragActor: () => new Clutter.Clone({
                source: tile.child,
                width: tile.child.width,
                height: tile.child.height,
            }),
            getDragActorSource: () => tile,
            handleDragOver: (source, _actor, x) => {
                if (!source?.isFolderApp || source.folderId !== folderId ||
                    source.appId === appId)
                    return DND.DragMotionResult.NO_DROP;
                ext._setDropMark(tile, null, afterOf(x, tile));
                return DND.DragMotionResult.MOVE_DROP;
            },
            acceptDrop: (source, _actor, x) => {
                if (!source?.isFolderApp || source.folderId !== folderId ||
                    source.appId === appId)
                    return false;
                const after = afterOf(x, tile);
                // Popup wird durch die Änderung neu aufgebaut – nicht mitten im Drop
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    ext.moveInFolder(folderId, source.appId, appId, after);
                    return GLib.SOURCE_REMOVE;
                });
                return true;
            },
        };

        const draggable = DND.makeDraggable(tile, {timeoutThreshold: 200});
        draggable.connect('drag-begin', () => {
            tile.opacity = 80;
        });
        draggable.connect('drag-end', () => {
            try {
                tile.opacity = 255;
            } catch (e) {
                // Kachel wurde beim Neuaufbau schon zerstört
            }
        });
    }

    // DND-Quelle
    getDragActor() {
        return new Clutter.Clone({
            source: this._tile,
            width: this._tile.width,
            height: this._tile.height,
        });
    }

    getDragActorSource() {
        return this._tile;
    }

    // DND-Ziel
    _dropAfter(x, y) {
        return this._dash._isHorizontal
            ? x > this._button.width / 2
            : y > this._button.height / 2;
    }

    handleDragOver(source, _actor, x, y) {
        if (source?.isFolder) {
            if (source === this)
                return DND.DragMotionResult.NO_DROP;
            this._ext._setDropMark(this._button, this._dash, this._dropAfter(x, y));
            return DND.DragMotionResult.COPY_DROP;
        }
        if (!source?.app?.get_id?.())
            return DND.DragMotionResult.NO_DROP;
        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, y) {
        if (source?.isFolder) {
            if (source === this)
                return false;
            this._ext.setFolderAnchor(source.id,
                {kind: 'folder', id: this.id, after: this._dropAfter(x, y)});
            return true;
        }
        const id = source?.app?.get_id?.();
        if (!id)
            return false;
        this._ext.addToFolder(id, this.id);
        return true;
    }
}

export default class AppFolderDockExtension extends Extension {
    enable() {
        this._enabled = true;
        this._active = false;
        this._activating = false;
        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed::folders', () => this._resyncAll());

        this._stateId = Main.extensionManager.connect('extension-state-changed',
            (_manager, extension) => {
                if (extension.uuid !== DTD_UUID)
                    return;
                if (extension.state === EXTENSION_ENABLED)
                    this._activate();
                else
                    this._deactivate();
            });

        if (Main.extensionManager.lookup(DTD_UUID)?.state === EXTENSION_ENABLED)
            this._activate();
    }

    disable() {
        this._enabled = false;
        Main.extensionManager.disconnect(this._stateId);
        this._settings.disconnect(this._settingsId);
        this._deactivate();
        this._settings = null;
    }

    // ---- Anbindung an Dash to Dock ------------------------------------

    async _activate() {
        if (this._active || this._activating)
            return;
        this._activating = true;

        try {
            const base = `file://${Main.extensionManager.lookup(DTD_UUID).path}`;
            const [dashMod, iconsMod, themingMod, dtdMod] = await Promise.all([
                import(`${base}/dash.js`),
                import(`${base}/appIcons.js`),
                import(`${base}/theming.js`),
                import(`${base}/extension.js`),
            ]);

            const dtdState = Main.extensionManager.lookup(DTD_UUID)?.state;
            if (!this._enabled || dtdState !== EXTENSION_ENABLED)
                return;

            this._dtd = dtdMod;
            itemShowLabel = iconsMod.itemShowLabel;
            positionStyleClass = themingMod.PositionStyleClass;

            this._patchDash(dashMod.DockDash.prototype);
            this._patchAppIcons(iconsMod.DockAbstractAppIcon.prototype);
            this._dragMonitor = {
                dragMotion: event => {
                    const outside = target => !(event.targetActor &&
                        (event.targetActor === target || target.contains(event.targetActor)));
                    if (this._mergeTarget && outside(this._mergeTarget))
                        this._setMergeTarget(null);
                    if (this._dropMark && outside(this._dropMark.actor))
                        this._clearDropMark();
                    return DND.DragMotionResult.CONTINUE;
                },
                dragDrop: () => {
                    this._setMergeTarget(null);
                    this._clearDropMark();
                    return DND.DragDropResult.CONTINUE;
                },
            };
            DND.addDragMonitor(this._dragMonitor);
            this._active = true;
            this._resyncAll();
            this._docks().forEach(dock => dock.dash._queueRedisplay());
        } catch (e) {
            console.error(`[dock-folders] Aktivierung fehlgeschlagen: ${e}\n${e.stack}`);
        } finally {
            this._activating = false;
        }
    }

    _deactivate() {
        if (!this._active)
            return;
        this._active = false;

        if (this._dashProto)
            this._dashProto._redisplay = this._origRedisplay;
        if (this._iconProto) {
            this._iconProto.popupMenu = this._origPopupMenu;
            for (const [name, desc] of [
                ['handleDragOver', this._origHandleDragOver],
                ['acceptDrop', this._origAcceptDrop],
            ]) {
                if (desc)
                    Object.defineProperty(this._iconProto, name, desc);
                else
                    delete this._iconProto[name];
            }
        }
        this._setMergeTarget(null);
        this._clearDropMark();
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        if (this._menuProto)
            this._menuProto._rebuildMenu = this._origRebuildMenu;
        this._dashProto = this._iconProto = this._menuProto = null;

        this._docks().forEach(dock => this._teardownDash(dock.dash));
        this._dtd = null;
    }

    _docks() {
        return this._dtd?.dockManager?._allDocks ?? [];
    }

    _patchDash(proto) {
        const ext = this;
        this._dashProto = proto;
        this._origRedisplay = proto._redisplay;
        proto._redisplay = function (...args) {
            ext._beforeRedisplay(this);
            try {
                return ext._origRedisplay.apply(this, args);
            } finally {
                ext._afterRedisplay(this);
            }
        };
    }

    _patchAppIcons(proto) {
        const ext = this;
        this._iconProto = proto;
        this._origPopupMenu = proto.popupMenu;
        this._origHandleDragOver = Object.getOwnPropertyDescriptor(proto, 'handleDragOver');
        this._origAcceptDrop = Object.getOwnPropertyDescriptor(proto, 'acceptDrop');

        // App auf App ziehen → Ordner. Nur im mittleren Bereich des Icons;
        // am Rand bleibt es beim normalen Umsortieren (CONTINUE → Dash).
        proto.handleDragOver = function (source, _actor, x, y) {
            if (source?.isFolder) {
                const dash = this.get_parent()?.get_parent()?._delegate;
                dash?._clearDragPlaceholder?.();
                ext._setDropMark(this, dash, ext._after(dash, this, x, y));
                return DND.DragMotionResult.COPY_DROP;
            }
            if (!ext._canMerge(source, this))
                return DND.DragMotionResult.CONTINUE;
            const inCenter = x > this.width * 0.25 && x < this.width * 0.75 &&
                y > this.height * 0.25 && y < this.height * 0.75;
            if (!inCenter) {
                ext._setMergeTarget(null);
                return DND.DragMotionResult.CONTINUE;
            }
            // Platzhalter vom Umsortieren entfernen, solange wir Merge-Ziel sind
            this.get_parent()?.get_parent()?._delegate?._clearDragPlaceholder?.();
            ext._setMergeTarget(this);
            return DND.DragMotionResult.COPY_DROP;
        };
        proto.acceptDrop = function (source, _actor, x, y) {
            if (source?.isFolder) {
                const id = this.app?.get_id();
                if (!id)
                    return false;
                const dash = this.get_parent()?.get_parent()?._delegate;
                ext.setFolderAnchor(source.id,
                    {kind: 'app', id, after: ext._after(dash, this, x, y)});
                return true;
            }
            // Der Drag-Monitor hat das Highlight zu diesem Zeitpunkt schon entfernt,
            // deshalb die Position erneut prüfen.
            const inCenter = x > this.width * 0.25 && x < this.width * 0.75 &&
                y > this.height * 0.25 && y < this.height * 0.75;
            if (!ext._canMerge(source, this) || !inCenter)
                return false;
            ext.createFolderFrom(this.app.get_id(), source.app.get_id());
            return true;
        };
        proto.popupMenu = function (...args) {
            const result = ext._origPopupMenu.apply(this, args);
            if (this._menu && ext._patchMenu(this._menu))
                this._menu._rebuildMenu();
            return result;
        };
    }

    _canMerge(source, target) {
        const a = source?.app;
        const b = target?.app;
        if (!a || !b || a === b || source === target)
            return false;
        const ok = app => app.get_id() && !app.is_window_backed() &&
            !app.location && !app.isTrash;
        return ok(a) && ok(b);
    }

    _after(dash, actor, x, y) {
        return dash?._isHorizontal === false ? y > actor.height / 2 : x > actor.width / 2;
    }

    // Einfüge-Markierung (Balken vor/hinter dem Ziel-Icon) beim Verschieben eines Ordners
    _setDropMark(actor, dash, after) {
        const horizontal = dash?._isHorizontal !== false;
        const cls = horizontal
            ? (after ? 'afd-drop-right' : 'afd-drop-left')
            : (after ? 'afd-drop-bottom' : 'afd-drop-top');
        if (this._dropMark?.actor === actor && this._dropMark.cls === cls)
            return;
        this._clearDropMark();
        actor.add_style_class_name(cls);
        this._dropMark = {actor, cls};
    }

    _clearDropMark() {
        if (!this._dropMark)
            return;
        this._dropMark.actor.remove_style_class_name(this._dropMark.cls);
        this._dropMark = null;
    }

    _setMergeTarget(icon) {
        if (this._mergeTarget === icon)
            return;
        this._mergeTarget?.remove_style_class_name('afd-merge-target');
        this._mergeTarget = icon;
        icon?.add_style_class_name('afd-merge-target');
    }

    // Patcht DockAppIconMenu.prototype einmalig; true, wenn gerade gepatcht wurde
    _patchMenu(menu) {
        const proto = Object.getPrototypeOf(menu);
        if (this._menuProto === proto)
            return false;
        if (this._menuProto)
            return false;

        const ext = this;
        this._menuProto = proto;
        this._origRebuildMenu = proto._rebuildMenu;
        proto._rebuildMenu = function (...args) {
            ext._origRebuildMenu.apply(this, args);
            ext._addFolderEntries(this);
        };
        return true;
    }

    _addFolderEntries(menu) {
        const app = menu.sourceActor?.app;
        const id = app?.get_id?.();
        if (!id || app.is_window_backed())
            return;

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const sub = new PopupMenu.PopupSubMenuMenuItem('Zu Ordner hinzufügen');
        this._load().forEach(folder => {
            const item = new PopupMenu.PopupMenuItem(folder.name);
            item.connect('activate', () => this.addToFolder(id, folder.id));
            sub.menu.addMenuItem(item);
        });
        const fresh = new PopupMenu.PopupMenuItem('Neuer Ordner …');
        fresh.connect('activate', () => this.createFolder(id));
        sub.menu.addMenuItem(fresh);
        menu.addMenuItem(sub);
    }

    // ---- Dash-Synchronisierung ----------------------------------------

    _items(dash) {
        dash._afdItems ??= new Map();
        return dash._afdItems;
    }

    _beforeRedisplay(dash) {
        const box = dash._box;
        for (const item of this._items(dash).values()) {
            if (item.actor.get_parent() === box)
                box.remove_child(item.actor);
        }
    }

    _afterRedisplay(dash) {
        if (!this._active || !dash._box)
            return;
        const box = dash._box;
        const folders = this._load();
        const items = this._items(dash);

        if (!dash._afdConnected) {
            dash._afdConnected = true;
            dash.connect('destroy', () => this._teardownDash(dash));
            dash.connect('icon-size-changed', () => this._updateItems(dash));
        }

        // Mitglieder ausblenden
        const hidden = new Set(folders.flatMap(f => f.apps));
        for (const actor of box.get_children()) {
            const app = actor.child?._delegate?.app;
            if (app)
                actor.visible = !hidden.has(app.get_id());
        }

        // Verwaiste Ordner-Items entfernen
        for (const [id, item] of items) {
            if (!folders.some(f => f.id === id)) {
                item.actor.destroy();
                items.delete(id);
            }
        }

        // Ordner-Items anlegen/aktualisieren
        const pending = [];
        for (const folder of folders) {
            let item = items.get(folder.id);
            if (!item) {
                item = new FolderItem(this, dash, folder);
                items.set(folder.id, item);
                item.isNew = true;
            }
            item.update(folder, dash.iconSize);
            if (item.actor.get_parent() !== box)
                pending.push(folder);
        }

        // Platzieren: Anker auf andere Ordner erst nach deren Platzierung auflösen
        const placed = new Set(folders.filter(f => !pending.includes(f)).map(f => f.id));
        const insert = (folder, index) => {
            const item = items.get(folder.id);
            box.insert_child_at_index(item.actor, index);
            if (item.isNew) {
                item.isNew = false;
                item.actor.show(false);
            }
            placed.add(folder.id);
        };
        let progress = true;
        while (pending.length && progress) {
            progress = false;
            for (let i = 0; i < pending.length; i++) {
                const index = this._resolveIndex(dash, pending[i], folders, placed);
                if (index === null)
                    continue;
                insert(pending[i], index);
                pending.splice(i--, 1);
                progress = true;
            }
        }
        for (const folder of pending)
            insert(folder, this._defaultIndex(dash, folder));
    }

    _defaultIndex(dash, folder) {
        const kids = dash._box.get_children();
        const index = kids.findIndex(a => {
            const app = a.child?._delegate?.app;
            return app && folder.apps.includes(app.get_id());
        });
        if (index >= 0)
            return index;
        return dash._separator ? kids.indexOf(dash._separator) : kids.length;
    }

    // null = Anker ist ein Ordner, der noch nicht platziert wurde
    _resolveIndex(dash, folder, folders, placed) {
        const kids = dash._box.get_children();
        const anchor = folder.anchor;
        if (anchor?.kind === 'app') {
            const index = kids.findIndex(a => a.child?._delegate?.app?.get_id() === anchor.id);
            if (index >= 0)
                return index + (anchor.after ? 1 : 0);
        } else if (anchor?.kind === 'folder' && folders.some(f => f.id === anchor.id)) {
            if (!placed.has(anchor.id))
                return null;
            const index = kids.indexOf(this._items(dash).get(anchor.id)?.actor);
            if (index >= 0)
                return index + (anchor.after ? 1 : 0);
        }
        return this._defaultIndex(dash, folder);
    }

    _updateItems(dash) {
        const folders = this._load();
        for (const [id, item] of this._items(dash)) {
            const folder = folders.find(f => f.id === id);
            if (folder)
                item.update(folder, dash.iconSize);
        }
    }

    _resyncAll() {
        if (!this._active)
            return;
        for (const dock of this._docks()) {
            this._beforeRedisplay(dock.dash);
            this._afterRedisplay(dock.dash);
        }
    }

    _teardownDash(dash) {
        if (!dash._afdItems)
            return;
        for (const item of dash._afdItems.values())
            item.actor.destroy();
        dash._afdItems.clear();

        try {
            for (const actor of dash._box.get_children()) {
                if (actor.child?._delegate?.app)
                    actor.visible = true;
            }
        } catch (e) {
            // Dash wird gerade zerstört
        }
    }

    // ---- Datenmodell ---------------------------------------------------

    _load() {
        try {
            const data = JSON.parse(this._settings.get_string('folders'));
            return Array.isArray(data) ? data : [];
        } catch (e) {
            return [];
        }
    }

    _save(folders) {
        this._settings.set_string('folders',
            JSON.stringify(folders.filter(f => f.apps.length > 0)));
    }

    getFolder(id) {
        return this._load().find(f => f.id === id) ?? null;
    }

    resolveApps(folder) {
        const system = Shell.AppSystem.get_default();
        return folder.apps.map(id => system.lookup_app(id)).filter(app => app);
    }

    addToFolder(appId, folderId) {
        const folders = this._load();
        folders.forEach(f => {
            f.apps = f.apps.filter(id => id !== appId);
        });
        const target = folders.find(f => f.id === folderId);
        if (!target)
            return;
        target.apps.push(appId);
        this._save(folders);
    }

    createFolder(appId) {
        const folders = this._load();
        folders.forEach(f => {
            f.apps = f.apps.filter(id => id !== appId);
        });
        folders.push({
            id: GLib.uuid_string_random(),
            name: `Ordner ${folders.length + 1}`,
            apps: [appId],
        });
        this._save(folders);
    }

    createFolderFrom(targetId, droppedId) {
        const folders = this._load();
        folders.forEach(f => {
            f.apps = f.apps.filter(id => id !== targetId && id !== droppedId);
        });
        folders.push({
            id: GLib.uuid_string_random(),
            name: `Ordner ${folders.length + 1}`,
            apps: [targetId, droppedId],
        });
        this._save(folders);
    }

    moveInFolder(folderId, appId, targetId, after) {
        const folders = this._load();
        const folder = folders.find(f => f.id === folderId);
        if (!folder || appId === targetId)
            return;
        folder.apps = folder.apps.filter(id => id !== appId);
        const index = folder.apps.indexOf(targetId);
        if (index < 0)
            return;
        folder.apps.splice(index + (after ? 1 : 0), 0, appId);
        this._save(folders);
    }

    setFolderAnchor(folderId, anchor) {
        const folders = this._load();
        const folder = folders.find(f => f.id === folderId);
        if (!folder)
            return;
        // Anker auf sich selbst oder auf einen Ordner, der auf uns zeigt, vermeiden
        const target = anchor.kind === 'folder' ? folders.find(f => f.id === anchor.id) : null;
        if (anchor.kind === 'folder' && (!target || target.id === folderId))
            return;
        if (target?.anchor?.kind === 'folder' && target.anchor.id === folderId)
            delete target.anchor;
        folder.anchor = anchor;
        this._save(folders);
    }

    removeFromFolder(appId) {
        const folders = this._load();
        folders.forEach(f => {
            f.apps = f.apps.filter(id => id !== appId);
        });
        this._save(folders);
    }

    renameFolder(folderId, name) {
        const trimmed = name.trim();
        const folders = this._load();
        const folder = folders.find(f => f.id === folderId);
        if (!folder || !trimmed || folder.name === trimmed)
            return;
        folder.name = trimmed;
        this._save(folders);
    }

    dissolveFolder(folderId) {
        this._save(this._load().filter(f => f.id !== folderId));
    }
}
