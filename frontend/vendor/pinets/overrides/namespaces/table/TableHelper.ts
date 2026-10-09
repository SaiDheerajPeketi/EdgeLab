// EdgeLab modification, 2026-10-09: bounded native table state and rollback.
// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../Series';
import { TableObject, truncCoord, tableDimension, tableMeasure, tableError, TABLE_CELL_LIMIT } from './TableObject';
import { silentInSecondary } from '../silentInSecondary';

// Complete named-parameter lists for named-args detection. These MUST cover
// every parameter of the corresponding Pine function: if a key is missing, a
// call naming ONLY missing keys (e.g. `table.new(..., force_overlay=true)`)
// falls through to positional handling — the options object lands in the next
// positional slot and its values are silently dropped.
//prettier-ignore
const TABLE_NEW_PARAMS = [
    'position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width',
    'border_color', 'border_width', 'force_overlay',
];
//prettier-ignore
const TABLE_CELL_PARAMS = [
    'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign',
    'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family', 'text_formatting',
];
const TABLE_RANGE_PARAMS = ['start_column', 'start_row', 'end_column', 'end_row'];

// Detect the transpiler's trailing named-args object: a plain {key: val} bag
// carrying at least one known parameter name. TableObject is excluded because
// it shares property names with table.new params (bgcolor, position, ...) and
// can legitimately appear as a trailing positional arg (e.g. `table.clear(t)`).
function isNamedArgs(arg: any, params: string[]): boolean {
    return !!arg && typeof arg === 'object' && !Array.isArray(arg)
        && !(arg instanceof TableObject)
        && params.some((p) => p in arg);
}

export class TableHelper {
    private _tables: TableObject[] = [];

    constructor(private context: any) {}

    param(source: any, index: number = 0, name?: string) {
        return Series.from(source).get(index);
    }

    private _ensurePlotsEntry() {
        if (!this.context.plots['__tables__']) {
            this.context.plots['__tables__'] = {
                title: '__tables__',
                data: [],
                options: { style: 'table', overlay: true },
            };
        }
    }

    public syncToPlot() {
        this._ensurePlotsEntry();
        const time = this.context.marketData[0]?.openTime || 0;
        // Compact out deleted tables — bounded array (RC3), transparent output;
        // rollbackFromBar filters by _createdAtBar, orthogonal to _deleted.
        this._tables = this._tables.filter(tbl => !tbl._deleted);
        this.context.plots['__tables__'].data = [{
            time,
            value: this._tables.map(tbl => tbl.toPlotData()),
            options: { style: 'table' },
        }];
    }

    private _resolve(val: any): any {
        if (val === null || val === undefined) return val;
        // NAHelper object — Pine Script's `na` used as a value resolves to NaN.
        // This happens when na is a default parameter (e.g., `color background = na`).
        if (typeof val === 'object' && '__value' in val) return val.__value;
        if (typeof val === 'object' && Array.isArray(val.data) && typeof val.get === 'function') {
            return val.get(0);
        }
        if (typeof val === 'function') {
            return val();
        }
        return val;
    }

    // ── table.new ──────────────────────────────────────────────

    @silentInSecondary
    new(...args: any[]): TableObject {
        const defaults: any[] = ['top_right', 1, 1, '', '', 0, '', 0, false];
        const last = args[args.length - 1];
        const hasOpts = isNamedArgs(last, TABLE_NEW_PARAMS);
        const positional = hasOpts ? args.slice(0, -1) : args;
        const values = TABLE_NEW_PARAMS.map((name, i) => this._resolve(i < positional.length ? positional[i]
            : hasOpts && Object.prototype.hasOwnProperty.call(last, name) ? last[name] : defaults[i]));
        const position = this._position(values[0]);
        const columns = tableDimension(values[1]), rows = tableDimension(values[2]);
        const allocated = this._tables.reduce((count, table) => count + (!table._deleted && table.position !== position ? table.columns * table.rows : 0), 0);
        if (columns * rows + allocated > TABLE_CELL_LIMIT) tableError('Active Pine tables exceed 4096 allocated cells.');
        tableMeasure(values[5], 16, 'frame width', true);
        tableMeasure(values[7], 16, 'border width', true);
        if (typeof values[8] !== 'boolean') tableError('Table force_overlay requires a boolean.');
        const tbl = new TableObject(position, columns, rows, values[3], values[4], values[5], values[6], values[7], values[8]);
        tbl._createdAtBar = this.context.idx;
        tbl._setHelper(this);
        this._takePosition(tbl);
        // Keep all collection operations bounded even inside one long bar calculation.
        this._tables = this._tables.filter(table => !table._deleted);
        this._tables.push(tbl);
        return tbl;
    }

    private _position(value: any): string {
        if (!['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'].includes(value))
            tableError('Unsupported Pine table position.');
        return value;
    }

    private _range(tbl: TableObject, sc: any, sr: any, ec: any, er: any): [number, number, number, number] | null {
        const coordinates = [sc, sr, ec, er].map(value => truncCoord(this._resolve(value)));
        if (coordinates.some(Number.isNaN)) return null;
        const [left, top, right, bottom] = coordinates;
        if (left < 0 || top < 0 || right >= tbl.columns || bottom >= tbl.rows || left > right || top > bottom)
            tableError('Table range must be ordered and within its dimensions.');
        return [left, top, right, bottom];
    }

    // TradingView shows one table per position: the newest one (or the one last moved there).
    // The table it replaces is gone, which also keeps the table list bounded when a script
    // creates a table on every bar.
    private _takePosition(tbl: TableObject): void {
        for (const other of this._tables) {
            if (other !== tbl && !other._deleted && other.position === tbl.position) other._deleted = true;
        }
    }

    // Pine `table(arg)` is a type cast / typed-na, NOT a constructor.
    any(...args: any[]): TableObject | null {
        if (args.length === 1) {
            const arg = args[0];
            if (arg === null || arg === undefined) return null;
            if (typeof arg === 'object' && '__value' in arg) return null;  // NAHelper-like
            if (typeof arg === 'number' && isNaN(arg)) return null;
            if (arg instanceof TableObject) return arg;
            return null;
        }
        return this.new(...args);
    }

    // ── table.cell ─────────────────────────────────────────────

    @silentInSecondary
    cell(...args: any[]): void {
        let table_id: any;
        let column: any;
        let row: any;
        let text: any = '';
        let width: any = 0;
        let height: any = 0;
        let text_color: any = '#363a45';
        let text_halign: any = 'center';
        let text_valign: any = 'center';
        let text_size: any = 'normal';
        let bgcolor: any = '';
        let tooltip: any = '';
        let text_font_family: any = 'default';
        let text_formatting: any = 'none';

        // Detect trailing options object from transpiler's named-args pattern
        // e.g. table.cell(t1, 0, 0, {text: "X", text_color: "#fff", ...})
        const lastArg = args[args.length - 1];
        const hasOpts = isNamedArgs(lastArg, TABLE_CELL_PARAMS);

        if (hasOpts) {
            const opts = lastArg;
            // Positional args before the opts object:
            // args = [table_id, column, row, <text?>, opts]
            const posArgs = args.slice(0, -1);
            table_id = posArgs[0];
            column = posArgs.length > 1 ? posArgs[1] : (opts.column ?? 0);
            row = posArgs.length > 2 ? posArgs[2] : (opts.row ?? 0);
            text = posArgs[3] ?? opts.text ?? text;
            width = posArgs[4] ?? opts.width ?? width;
            height = posArgs[5] ?? opts.height ?? height;
            text_color = posArgs[6] ?? opts.text_color ?? text_color;
            text_halign = posArgs[7] ?? opts.text_halign ?? text_halign;
            text_valign = posArgs[8] ?? opts.text_valign ?? text_valign;
            text_size = posArgs[9] ?? opts.text_size ?? text_size;
            bgcolor = posArgs[10] ?? opts.bgcolor ?? bgcolor;
            tooltip = posArgs[11] ?? opts.tooltip ?? tooltip;
            text_font_family = posArgs[12] ?? opts.text_font_family ?? text_font_family;
            text_formatting = posArgs[13] ?? opts.text_formatting ?? text_formatting;
        } else {
            table_id = args[0];
            column = args[1] ?? 0;
            row = args[2] ?? 0;
            text = args[3] ?? text;
            width = args[4] ?? width;
            height = args[5] ?? height;
            text_color = args[6] ?? text_color;
            text_halign = args[7] ?? text_halign;
            text_valign = args[8] ?? text_valign;
            text_size = args[9] ?? text_size;
            bgcolor = args[10] ?? bgcolor;
            tooltip = args[11] ?? tooltip;
            text_font_family = args[12] ?? text_font_family;
            text_formatting = args[13] ?? text_formatting;
        }

        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;

        const col = this._resolve(column) ?? 0;
        const r = this._resolve(row) ?? 0;

        tbl.setCell(col, r, {
            text: this._resolveText(this._resolve(text)),
            width: this._resolve(width),
            height: this._resolve(height),
            text_color: this._resolve(text_color),
            text_halign: this._resolve(text_halign) || 'center',
            text_valign: this._resolve(text_valign) || 'center',
            text_size: this._resolve(text_size),
            bgcolor: this._resolve(bgcolor) || '',
            tooltip: this._resolveText(this._resolve(tooltip)),
            text_font_family: this._resolve(text_font_family) || 'default',
            text_formatting: this._resolve(text_formatting) || 'none',
        }, true);
    }

    // ── table.delete ───────────────────────────────────────────

    @silentInSecondary
    delete(id: TableObject): void {
        if (id) id._deleted = true;
    }

    // ── table.clear ────────────────────────────────────────────

    @silentInSecondary
    clear(...args: any[]): void {
        let table_id: any;
        let start_column: any;
        let start_row: any;
        let end_column: any;
        let end_row: any;

        const lastArg = args[args.length - 1];
        const hasOpts = isNamedArgs(lastArg, TABLE_RANGE_PARAMS);

        if (hasOpts) {
            const opts = lastArg;
            table_id = args[0];
            start_column = args.length > 2 ? args[1] : (opts.start_column ?? 0);
            start_row = args.length > 3 ? args[2] : (opts.start_row ?? 0);
            end_column = opts.end_column ?? (args.length > 4 ? args[3] : start_column);
            end_row = opts.end_row ?? (args.length > 5 ? args[4] : start_row);
        } else {
            table_id = args[0];
            start_column = args[1] ?? 0;
            start_row = args[2] ?? 0;
            end_column = args[3] ?? start_column;
            end_row = args[4] ?? start_row;
        }

        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;

        const range = this._range(tbl, start_column, start_row, end_column, end_row);
        if (!range) return;
        const [sc, sr, ec, er] = range;

        for (let r = sr; r <= er; r++) {
            for (let c = sc; c <= ec; c++) {
                tbl.clearCell(c, r);
            }
        }
    }

    // ── table.merge_cells ──────────────────────────────────────

    @silentInSecondary
    merge_cells(...args: any[]): void {
        let table_id: any;
        let start_column: any;
        let start_row: any;
        let end_column: any;
        let end_row: any;

        const lastArg = args[args.length - 1];
        const hasOpts = isNamedArgs(lastArg, TABLE_RANGE_PARAMS);

        if (hasOpts) {
            const opts = lastArg;
            table_id = args[0];
            start_column = args.length > 2 ? args[1] : (opts.start_column ?? 0);
            start_row = args.length > 3 ? args[2] : (opts.start_row ?? 0);
            end_column = opts.end_column ?? (args.length > 4 ? args[3] : 0);
            end_row = opts.end_row ?? (args.length > 5 ? args[4] : 0);
        } else {
            table_id = args[0];
            start_column = args[1] ?? 0;
            start_row = args[2] ?? 0;
            end_column = args[3] ?? 0;
            end_row = args[4] ?? 0;
        }

        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;

        const range = this._range(tbl, start_column, start_row, end_column, end_row);
        if (!range) return;
        const [sc, sr, ec, er] = range;
        if (sc === ec && sr === er) return;
        if (tbl.merges.some(m => sc <= m.endCol && ec >= m.startCol && sr <= m.endRow && er >= m.startRow))
            tableError('Table merge ranges cannot overlap existing merges.');

        // Merge membership is retained independently of cell properties, including
        // after clear. Child markers are copied for final native snapshot consumers.
        for (let r = sr; r <= er; r++) {
            for (let c = sc; c <= ec; c++) {
                if (r === sr && c === sc) continue; // Skip the origin cell
                tbl.markMerged(c, r, sc, sr);
            }
        }

        tbl.merges.push({ startCol: sc, startRow: sr, endCol: ec, endRow: er });
    }

    // ── Cell setter methods ────────────────────────────────────

    @silentInSecondary
    cell_set_text(table_id: any, column: any, row: any, text: any): void {
        this._setCellProp(table_id, column, row, 'text', text, true);
    }

    @silentInSecondary
    cell_set_bgcolor(table_id: any, column: any, row: any, bgcolor: any): void {
        this._setCellProp(table_id, column, row, 'bgcolor', bgcolor);
    }

    @silentInSecondary
    cell_set_text_color(table_id: any, column: any, row: any, text_color: any): void {
        this._setCellProp(table_id, column, row, 'text_color', text_color);
    }

    @silentInSecondary
    cell_set_text_size(table_id: any, column: any, row: any, text_size: any): void {
        this._setCellProp(table_id, column, row, 'text_size', text_size);
    }

    @silentInSecondary
    cell_set_height(table_id: any, column: any, row: any, height: any): void {
        this._setCellProp(table_id, column, row, 'height', height);
    }

    @silentInSecondary
    cell_set_width(table_id: any, column: any, row: any, width: any): void {
        this._setCellProp(table_id, column, row, 'width', width);
    }

    @silentInSecondary
    cell_set_tooltip(table_id: any, column: any, row: any, tooltip: any): void {
        this._setCellProp(table_id, column, row, 'tooltip', tooltip, true);
    }

    @silentInSecondary
    cell_set_text_halign(table_id: any, column: any, row: any, text_halign: any): void {
        this._setCellProp(table_id, column, row, 'text_halign', text_halign);
    }

    @silentInSecondary
    cell_set_text_valign(table_id: any, column: any, row: any, text_valign: any): void {
        this._setCellProp(table_id, column, row, 'text_valign', text_valign);
    }

    @silentInSecondary
    cell_set_text_font_family(table_id: any, column: any, row: any, text_font_family: any): void {
        this._setCellProp(table_id, column, row, 'text_font_family', text_font_family);
    }

    @silentInSecondary
    cell_set_text_formatting(table_id: any, column: any, row: any, text_formatting: any): void {
        this._setCellProp(table_id, column, row, 'text_formatting', text_formatting);
    }

    // ── Table setter methods ───────────────────────────────────

    @silentInSecondary
    set_position(table_id: any, position: any): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;
        tbl.position = this._position(this._resolve(position));
        this._takePosition(tbl);
    }

    @silentInSecondary
    set_bgcolor(table_id: any, bgcolor: any): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;
        tbl.bgcolor = this._resolve(bgcolor) || '';
    }

    @silentInSecondary
    set_border_color(table_id: any, border_color: any): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;
        tbl.border_color = this._resolve(border_color) || '';
    }

    @silentInSecondary
    set_border_width(table_id: any, border_width: any): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;
        tbl.border_width = tableMeasure(this._resolve(border_width), 16, 'border width', true);
    }

    @silentInSecondary
    set_frame_color(table_id: any, frame_color: any): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;
        tbl.frame_color = this._resolve(frame_color) || '';
    }

    @silentInSecondary
    set_frame_width(table_id: any, frame_width: any): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;
        tbl.frame_width = tableMeasure(this._resolve(frame_width), 16, 'frame width', true);
    }

    // ── Property getter ────────────────────────────────────────

    get all(): TableObject[] {
        return this._tables.filter((t) => !t._deleted);
    }

    /**
     * Remove all tables created at or after the given bar index.
     * Called during streaming rollback.
     */
    rollbackFromBar(barIdx: number): void {
        this._tables = this._tables.filter(table => table._createdAtBar < barIdx);
        this.syncToPlot();
    }

    // ── Private helpers ────────────────────────────────────────

    private _setCellProp(table_id: any, column: any, row: any, prop: string, value: any, isText: boolean = false): void {
        const tbl = this._resolve(table_id) as TableObject;
        if (!tbl || tbl._deleted) return;

        const col = this._resolve(column) ?? 0;
        const r = this._resolve(row) ?? 0;
        const resolved = this._resolve(value);

        tbl.setCell(col, r, {
            [prop]: isText ? this._resolveText(resolved) : resolved,
        } as any);
    }

    private _resolveText(val: any): string {
        if (val === null || val === undefined || val !== val) return '';
        return String(val);
    }
}
