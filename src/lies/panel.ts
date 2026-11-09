/** Tiny DOM helpers shared by the lie-* example pages (same look as the other series' control panels). */

export interface LieLink {
    href: string;
    label: string;
}

/** All lie-* demos, in article order — used for the footer navigation. */
export const LIE_PAGES: LieLink[] = [
    { href: "lie-pity-timer.html", label: "Pity Timer" },
    { href: "lie-dice-true-hit.html", label: "Dice & True Hit" },
    { href: "lie-poisson.html", label: "Poisson vs Random" },
    { href: "lie-storyteller.html", label: "Storyteller" },
    { href: "lie-attack-tokens.html", label: "Attack Tokens" },
    { href: "lie-possibility-map.html", label: "Possibility Map" },
    { href: "lie-dda.html", label: "DDA" },
    { href: "lie-spawn-sight.html", label: "Spawn Out of Sight" },
    { href: "lie-hitboxes.html", label: "Hitboxes" },
    { href: "lie-hit-stop.html", label: "Hit Stop" },
    { href: "lie-interpolation.html", label: "Interpolation" },
    { href: "lie-foot-ik.html", label: "Foot IK" },
];

export function addHeading(root: HTMLElement, text: string): void {
    const h = document.createElement("h2");
    h.textContent = text;
    root.appendChild(h);
}

export function addSlider(
    root: HTMLElement,
    label: string,
    opts: { min: number; max: number; step: number; value: number; format: (v: number) => string },
    onChange: (v: number) => void,
): (v: number) => void {
    const row = document.createElement("div");
    row.className = "control-row";
    const l = document.createElement("label");
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(opts.min);
    input.max = String(opts.max);
    input.step = String(opts.step);
    input.value = String(opts.value);
    input.style.width = "90px";
    const value = document.createElement("span");
    value.style.minWidth = "44px";
    value.style.textAlign = "right";
    value.style.fontVariantNumeric = "tabular-nums";
    value.textContent = opts.format(opts.value);
    input.addEventListener("input", () => {
        const v = Number(input.value);
        value.textContent = opts.format(v);
        onChange(v);
    });
    row.append(l, input, value);
    root.appendChild(row);
    return (v: number) => {
        input.value = String(v);
        value.textContent = opts.format(v);
    };
}

/** A row of toggle buttons where exactly one is active. */
export function addSegmented<T extends string>(
    root: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    initial: T,
    onChange: (v: T) => void,
): void {
    const caption = document.createElement("div");
    caption.textContent = label;
    caption.style.margin = "0 0 4px";
    root.appendChild(caption);
    const row = document.createElement("div");
    row.className = "control-row";
    row.style.flexWrap = "wrap";
    row.style.justifyContent = "flex-start";
    row.style.gap = "4px";
    const buttons: HTMLButtonElement[] = [];
    const paint = (active: T) => {
        buttons.forEach((b, i) => {
            const on = options[i].value === active;
            b.style.background = on ? "#2f4a36" : "";
            b.style.borderColor = on ? "#6fd48a" : "";
            b.style.color = on ? "#e6f5ea" : "";
        });
    };
    for (const opt of options) {
        const b = document.createElement("button");
        b.textContent = opt.label;
        b.style.fontSize = "11px";
        b.addEventListener("click", () => {
            paint(opt.value);
            onChange(opt.value);
        });
        buttons.push(b);
        row.appendChild(b);
    }
    paint(initial);
    root.appendChild(row);
}

export function addButtons(root: HTMLElement, buttons: Array<{ label: string; onClick: () => void }>): void {
    const row = document.createElement("div");
    row.className = "control-row";
    row.style.flexWrap = "wrap";
    row.style.justifyContent = "flex-start";
    row.style.gap = "4px";
    for (const spec of buttons) {
        const b = document.createElement("button");
        b.textContent = spec.label;
        b.addEventListener("click", spec.onClick);
        row.appendChild(b);
    }
    root.appendChild(row);
}

export function addCheckbox(root: HTMLElement, label: string, initial: boolean, onChange: (v: boolean) => void): void {
    const row = document.createElement("div");
    row.className = "control-row";
    const l = document.createElement("label");
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    input.addEventListener("change", () => onChange(input.checked));
    row.append(l, input);
    root.appendChild(row);
}

/**
 * Metrics table with an optional header row (e.g. "честно | соврали"); returns a setter
 * `set(rowKey, colIndex, text)`.
 */
export function addMetrics(
    root: HTMLElement,
    columns: string[],
    rows: Array<[key: string, label: string]>,
): (key: string, col: number, text: string) => void {
    const table = document.createElement("table");
    table.className = "metrics-table";
    if (columns.length > 1) {
        const tr = document.createElement("tr");
        tr.appendChild(document.createElement("td"));
        for (const c of columns) {
            const td = document.createElement("td");
            td.textContent = c;
            td.style.color = "#8b93a3";
            td.style.fontSize = "11px";
            td.style.textAlign = "right";
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    const cells: Record<string, HTMLTableCellElement[]> = {};
    for (const [key, label] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("td");
        th.textContent = label;
        tr.appendChild(th);
        cells[key] = [];
        for (let c = 0; c < columns.length; c++) {
            const td = document.createElement("td");
            td.textContent = "-";
            td.style.textAlign = "right";
            td.style.fontVariantNumeric = "tabular-nums";
            td.style.color = "#6fd48a";
            td.style.paddingLeft = "6px";
            cells[key].push(td);
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    root.appendChild(table);
    return (key, col, text) => {
        const cell = cells[key]?.[col];
        if (cell && cell.textContent !== text) cell.textContent = text;
    };
}

export function addNote(root: HTMLElement, text: string): void {
    const note = document.createElement("div");
    note.style.color = "#8b93a3";
    note.style.fontSize = "11px";
    note.style.margin = "4px 0 10px";
    note.textContent = text;
    root.appendChild(note);
}

export function addFooter(root: HTMLElement, currentHref: string): void {
    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    const links = LIE_PAGES.filter((p) => p.href !== currentHref)
        .map((p) => `<a href="${p.href}" style="color:#4fc3f7">${p.label}</a>`)
        .join(" &middot; ");
    hint.innerHTML =
        "Часть примеров к статье о том, как игры врут игроку. " +
        `<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ${links}`;
    root.appendChild(hint);
}
