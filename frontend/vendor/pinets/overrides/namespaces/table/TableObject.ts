// EdgeLab modification, 2026-10-09: bounded native table state and rollback.
// SPDX-License-Identifier: AGPL-3.0-only

let _tableIdCounter = 0;

export function resetTableIdCounter() {
    _tableIdCounter = 0;
}

/**
 * Pine truncates fractional "int" values at the point of use: since v6,
 * `int / int` keeps the static type `int` but can carry a fractional value
 * (e.g. `(i / 6) + 1` with a loop counter), and TradingView truncates it
 * toward zero when it is consumed as a table coordinate. NaN (Pine `na`)
 * stays NaN so the bounds checks below reject it as a silent no-op.
 */
export function truncCoord(v: number): number {
    return Number.isFinite(v) ? Math.trunc(v) : NaN;
}

export const TABLE_CELL_LIMIT = 4096;
export function tableError(message: string): never {
    const error: any = new Error(message); error.code = 'INVALID_TABLE'; throw error;
}
export function tableDimension(value: any): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) tableError('Table dimensions require finite positive integers.');
    const size = Math.trunc(value);
    if (size < 1 || size > TABLE_CELL_LIMIT) tableError('Table dimensions exceed the 4096-cell limit.');
    return size;
}
export function tableMeasure(value: any, limit: number, label: string, integer = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > limit || (integer && !Number.isSafeInteger(value)))
        tableError('Invalid table ' + label + '.');
    return value;
}
export interface TableCell {
    populated: boolean;
    text: string;
    width: number;
    height: number;
    text_color: string;
    text_halign: string;
    text_valign: string;
    text_size: string | number;
    bgcolor: string;
    tooltip: string;
    text_font_family: string;
    text_formatting: string;
    _merged: boolean;
    _merge_parent: [number, number] | null; // [col, row] of the merge origin
}

export interface MergeRegion {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
}

export class TableObject {
    public id: number;
    public position: string;
    public columns: number;
    public rows: number;
    public bgcolor: string;
    public frame_color: string;
    public frame_width: number;
    public border_color: string;
    public border_width: number;
    public force_overlay: boolean;
    public _deleted: boolean;
    public _createdAtBar: number = -1;
    public cells: (TableCell | null)[][];
    public merges: MergeRegion[];
    private _helper: any;

    constructor(
        position: string = 'top_right',
        columns: number = 1,
        rows: number = 1,
        bgcolor: string = '',
        frame_color: string = '',
        frame_width: number = 0,
        border_color: string = '',
        border_width: number = 0,
        force_overlay: boolean = false,
    ) {
        this.id = _tableIdCounter++;
        this.position = position;
        this.columns = tableDimension(columns);
        this.rows = tableDimension(rows);
        if (this.columns * this.rows > TABLE_CELL_LIMIT) tableError('A Pine table exceeds 4096 allocated cells.');
        this.bgcolor = bgcolor;
        this.frame_color = frame_color;
        this.frame_width = frame_width;
        this.border_color = border_color;
        this.border_width = border_width;
        this.force_overlay = force_overlay;
        this._deleted = false;
        this.merges = [];

        // Initialize cells grid (rows × columns) with nulls
        this.cells = [];
        for (let r = 0; r < this.rows; r++) {
            this.cells[r] = [];
            for (let c = 0; c < this.columns; c++) {
                this.cells[r][c] = null;
            }
        }
    }

    delete(): void {
        this._deleted = true;
    }

    toPlotData(): any {
        // Deep-copy cells to avoid exposing internal mutable state
        const cellsCopy = this.cells.map(row =>
            row.map(cell => cell ? { ...cell, _merge_parent: cell._merge_parent ? [...cell._merge_parent] : null } : null)
        );
        return {
            id: this.id,
            position: this.position,
            columns: this.columns,
            rows: this.rows,
            bgcolor: this.bgcolor,
            frame_color: this.frame_color,
            frame_width: this.frame_width,
            border_color: this.border_color,
            border_width: this.border_width,
            force_overlay: this.force_overlay,
            _deleted: this._deleted,
            cells: cellsCopy,
            merges: this.merges.map(m => ({ ...m })),
        };
    }

    setCell(column: number, row: number, props: Partial<TableCell>, populate = false): void {
        column = truncCoord(column);
        row = truncCoord(row);
        if (!(row >= 0 && row < this.rows && column >= 0 && column < this.columns)) return;

        // Only the first cell in a merged range can change its visible properties.
        if (this.merges.some(m => column >= m.startCol && column <= m.endCol && row >= m.startRow && row <= m.endRow &&
            (column !== m.startCol || row !== m.startRow))) return;
        for (const [key, value] of Object.entries(props)) {
            if (key === 'width' || key === 'height') tableMeasure(value, 1_000_000, key);
            if (key === 'text_size' && typeof value === 'number') tableMeasure(value, 512, key);
            if ((key === 'text' || key === 'tooltip') && (typeof value !== 'string' || value.length > 4096)) tableError('Table text exceeds 4096 characters.');
        }
        const cell = this.cells[row][column] || this._defaultCell();
        Object.assign(cell, props);
        if (populate) cell.populated = true;
        this.cells[row][column] = cell;
    }

    /** Marks a cell as part of the merge region whose origin is (originCol, originRow). */
    markMerged(column: number, row: number, originCol: number, originRow: number): void {
        if (!(row >= 0 && row < this.rows && column >= 0 && column < this.columns)) return;
        const cell = this.cells[row][column] || this._defaultCell();
        cell._merged = true;
        cell._merge_parent = [originCol, originRow];
        this.cells[row][column] = cell;
    }

    getCell(column: number, row: number): TableCell | null {
        column = truncCoord(column);
        row = truncCoord(row);
        if (!(row >= 0 && row < this.rows && column >= 0 && column < this.columns)) return null;
        return this.cells[row][column];
    }

    clearCell(column: number, row: number): void {
        column = truncCoord(column);
        row = truncCoord(row);
        if (!(row >= 0 && row < this.rows && column >= 0 && column < this.columns)) return;
        this.cells[row][column] = null;
    }

    // ── Helper injection (mirrors PineArrayObject pattern) ──────
    _setHelper(helper: any): void {
        this._helper = helper;
    }

    // ── Pine Script method-call delegates ───────────────────────
    // Enables tb.cell(...) syntax as sugar for table.cell(tb, ...)
    cell(...args: any[]) { return this._helper.cell(this, ...args); }
    clear(...args: any[]) { return this._helper.clear(this, ...args); }
    merge_cells(...args: any[]) { return this._helper.merge_cells(this, ...args); }

    cell_set_text(...args: any[]) { return this._helper.cell_set_text(this, ...args); }
    cell_set_bgcolor(...args: any[]) { return this._helper.cell_set_bgcolor(this, ...args); }
    cell_set_text_color(...args: any[]) { return this._helper.cell_set_text_color(this, ...args); }
    cell_set_text_size(...args: any[]) { return this._helper.cell_set_text_size(this, ...args); }
    cell_set_height(...args: any[]) { return this._helper.cell_set_height(this, ...args); }
    cell_set_width(...args: any[]) { return this._helper.cell_set_width(this, ...args); }
    cell_set_tooltip(...args: any[]) { return this._helper.cell_set_tooltip(this, ...args); }
    cell_set_text_halign(...args: any[]) { return this._helper.cell_set_text_halign(this, ...args); }
    cell_set_text_valign(...args: any[]) { return this._helper.cell_set_text_valign(this, ...args); }
    cell_set_text_font_family(...args: any[]) { return this._helper.cell_set_text_font_family(this, ...args); }
    cell_set_text_formatting(...args: any[]) { return this._helper.cell_set_text_formatting(this, ...args); }

    set_position(...args: any[]) { return this._helper.set_position(this, ...args); }
    set_bgcolor(...args: any[]) { return this._helper.set_bgcolor(this, ...args); }
    set_border_color(...args: any[]) { return this._helper.set_border_color(this, ...args); }
    set_border_width(...args: any[]) { return this._helper.set_border_width(this, ...args); }
    set_frame_color(...args: any[]) { return this._helper.set_frame_color(this, ...args); }
    set_frame_width(...args: any[]) { return this._helper.set_frame_width(this, ...args); }

    private _defaultCell(): TableCell {
        return {
            populated: false,
            text: '',
            width: 0,
            height: 0,
            text_color: '#363a45',
            text_halign: 'center',
            text_valign: 'center',
            text_size: 'normal',
            bgcolor: '',
            tooltip: '',
            text_font_family: 'default',
            text_formatting: 'none',
            _merged: false,
            _merge_parent: null,
        };
    }
}
