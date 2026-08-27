// lib/dev-feedback/capture.ts
//
// DEV-ONLY visual feedback overlay — pure capture/serialize/save helpers.
//
// This module is intentionally framework-agnostic and side-effect-free at import
// time: it only touches the DOM / window inside functions, never at module scope.
// It is imported by components/dev-feedback/FeedbackOverlay.tsx (a 'use client'
// component) and MUST NOT import any server-only module. Nothing here runs unless
// the overlay is activated by a reviewer.

/** A single captured element snapshot + the reviewer's note. */
export interface FeedbackItem {
	/** ISO timestamp of when the note was saved. */
	iso: string;
	/** The reviewer's note ("what should change here"). */
	note: string;
	/** Pathname (+ search) the note was taken on. */
	route: string;
	/** Robust unique CSS selector for the target element. */
	selector: string;
	/** Lowercased tag name, e.g. "button". */
	tag: string;
	/** Trimmed innerText, capped ~120 chars. */
	text: string;
	/** Element id, or "". */
	id: string;
	/** ARIA role (explicit attribute), or "". */
	role: string;
	/** aria-label, or "". */
	ariaLabel: string;
	/** data-* attributes as a flat record. */
	dataAttrs: Record<string, string>;
	/** className string (normalized), or "". */
	className: string;
	/** Bounding rect, rounded to whole pixels (viewport-relative). */
	rect: { x: number; y: number; w: number; h: number };
	/** React fiber source, if recoverable in dev (null in minified prod). */
	source: ElementSource | null;
}

/** React fiber `_debugSource` plus an optional resolved component name. */
export interface ElementSource {
	fileName?: string;
	lineNumber?: number;
	columnNumber?: number;
	/** displayName/name walked up via `_debugOwner`, if found. */
	componentName?: string;
}

const TEXT_CAP = 120;
const MAX_SELECTOR_DEPTH = 6;

// ---------------------------------------------------------------------------
// uniqueSelector
// ---------------------------------------------------------------------------

/** Is this id usable as a stable, unique #id selector right now? */
function isUsableId(el: Element): boolean {
	const id = el.getAttribute("id");
	if (!id) return false;
	// Reject ids that won't survive in a CSS selector (CSS.escape covers most,
	// but framework-generated ids with leading digits or weird chars are noisy).
	if (/\s/.test(id)) return false;
	try {
		return el.ownerDocument.querySelectorAll(`#${cssEscape(id)}`).length === 1;
	} catch {
		return false;
	}
}

function cssEscape(value: string): string {
	const w = typeof window !== "undefined" ? (window as unknown as { CSS?: { escape?: (s: string) => string } }) : undefined;
	if (w?.CSS?.escape) return w.CSS.escape(value);
	// Minimal fallback escape for environments without CSS.escape.
	return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

/** :nth-of-type index (1-based) of `el` among same-tag siblings. */
function nthOfType(el: Element): number {
	const tag = el.tagName;
	let i = 1;
	let sib = el.previousElementSibling;
	while (sib) {
		if (sib.tagName === tag) i++;
		sib = sib.previousElementSibling;
	}
	return i;
}

/** A short segment for one element: tag, plus :nth-of-type when it has siblings of the same tag. */
function segment(el: Element): string {
	const tag = el.tagName.toLowerCase();
	const parent = el.parentElement;
	if (!parent) return tag;
	const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
	if (sameTag.length <= 1) return tag;
	return `${tag}:nth-of-type(${nthOfType(el)})`;
}

/** Treat these as stable "anchor" roots to keep selectors short and robust. */
function isStableAnchor(el: Element): boolean {
	if (el.id && isUsableId(el)) return true;
	const tag = el.tagName.toLowerCase();
	if (tag === "main" || tag === "body" || tag === "header" || tag === "nav") return true;
	if (el.hasAttribute("data-slot")) return true;
	return false;
}

/**
 * Build a robust, unique CSS selector for `el`:
 *  - prefer the element's own #id when unique;
 *  - else walk up building tag(+:nth-of-type) segments, stopping at the first
 *    stable ancestor (#id / main / body / [data-slot] / header / nav), capping
 *    total depth so selectors stay readable.
 */
export function uniqueSelector(el: Element | null): string {
	if (!el || el.nodeType !== 1) return "";
	if (isUsableId(el)) return `#${cssEscape(el.getAttribute("id") as string)}`;

	const parts: string[] = [];
	let current: Element | null = el;
	let depth = 0;

	while (current && current.nodeType === 1 && depth < MAX_SELECTOR_DEPTH) {
		// If this node itself has a usable id, anchor on it and stop.
		if (current !== el && current.id && isUsableId(current)) {
			parts.unshift(`#${cssEscape(current.getAttribute("id") as string)}`);
			return parts.join(" > ");
		}

		// data-slot anchors are stable across rebuilds; prefer them in the path.
		const slot = current.getAttribute?.("data-slot");
		if (current !== el && slot) {
			parts.unshift(`[data-slot="${cssAttr(slot)}"]`);
			return parts.join(" > ");
		}

		parts.unshift(segment(current));

		const parent: Element | null = current.parentElement;
		// Stop once we've anchored beneath a stable landmark.
		if (parent && isStableAnchor(parent)) {
			if (parent.id && isUsableId(parent)) {
				parts.unshift(`#${cssEscape(parent.getAttribute("id") as string)}`);
			} else if (parent.hasAttribute("data-slot")) {
				parts.unshift(`[data-slot="${cssAttr(parent.getAttribute("data-slot") as string)}"]`);
			} else {
				parts.unshift(parent.tagName.toLowerCase());
			}
			break;
		}
		current = parent;
		depth++;
	}

	return parts.join(" > ");
}

function cssAttr(value: string): string {
	return value.replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

const REACT_FIBER_PREFIX = "__reactFiber$";
const REACT_PROPS_PREFIX = "__reactProps$";

interface FiberLike {
	_debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
	_debugOwner?: FiberLike | null;
	type?: unknown;
	return?: FiberLike | null;
}

/** Find the React fiber attached to a DOM node, if present (dev builds only). */
function getFiber(el: Element): FiberLike | null {
	const key = Object.keys(el).find((k) => k.startsWith(REACT_FIBER_PREFIX));
	if (!key) return null;
	return (el as unknown as Record<string, FiberLike>)[key] ?? null;
}

/** Resolve a component displayName/name from a fiber `type`. */
function componentNameFromType(type: unknown): string | undefined {
	if (!type) return undefined;
	if (typeof type === "string") return type; // host component — not useful as a "component"
	const t = type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
	if (t.displayName) return t.displayName;
	if (t.name) return t.name;
	// forwardRef/memo wrappers expose the inner under .render / .type
	if (t.render) return t.render.displayName ?? t.render.name;
	return undefined;
}

/**
 * Best-effort React source for an element, via the dev-only fiber.
 * Returns null in production (minified, no `_debugSource`). That is expected.
 */
function reactSource(el: Element): ElementSource | null {
	const fiber = getFiber(el);
	if (!fiber) return null;

	const out: ElementSource = {};

	// _debugSource lives on the fiber (or can be reached via the owner chain).
	const dbg = fiber._debugSource;
	if (dbg && (dbg.fileName || dbg.lineNumber)) {
		out.fileName = dbg.fileName;
		out.lineNumber = dbg.lineNumber;
		out.columnNumber = dbg.columnNumber;
	}

	// Walk _debugOwner (and the return chain as a fallback) for a component name.
	let owner: FiberLike | null | undefined = fiber._debugOwner ?? fiber.return;
	let guard = 0;
	while (owner && guard < 12) {
		const name = componentNameFromType(owner.type);
		// Skip host components (lowercase tag names) — we want a real component.
		if (name && /^[A-Z]/.test(name)) {
			out.componentName = name;
			if (!out.fileName && owner._debugSource?.fileName) {
				out.fileName = owner._debugSource.fileName;
				out.lineNumber = owner._debugSource.lineNumber;
			}
			break;
		}
		owner = owner._debugOwner ?? owner.return;
		guard++;
	}

	return out.fileName || out.componentName || out.lineNumber ? out : null;
}

/** Collect all data-* attributes as a flat record. */
function collectDataAttrs(el: Element): Record<string, string> {
	const out: Record<string, string> = {};
	for (const attr of Array.from(el.attributes)) {
		if (attr.name.startsWith("data-")) out[attr.name] = attr.value;
	}
	return out;
}

/** Normalize className whether it's a string or an SVGAnimatedString. */
function classNameOf(el: Element): string {
	const raw = (el as HTMLElement).className as unknown;
	if (typeof raw === "string") return raw.trim();
	if (raw && typeof raw === "object" && "baseVal" in (raw as object)) {
		return String((raw as { baseVal: string }).baseVal).trim();
	}
	return (el.getAttribute("class") ?? "").trim();
}

/** Current route: pathname + search (window may be undefined in non-browser). */
function currentRoute(): string {
	if (typeof window === "undefined") return "";
	return window.location.pathname + window.location.search;
}

/**
 * Snapshot an element into a serializable descriptor used by toMarkdown / save.
 * Pure aside from reading the live DOM/window; never mutates anything.
 */
export function describe(el: Element): Omit<FeedbackItem, "note" | "iso"> {
	const r = el.getBoundingClientRect();
	const rawText = (el as HTMLElement).innerText ?? el.textContent ?? "";
	const text = rawText.replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);

	return {
		route: currentRoute(),
		selector: uniqueSelector(el),
		tag: el.tagName.toLowerCase(),
		text,
		id: el.getAttribute("id") ?? "",
		role: el.getAttribute("role") ?? "",
		ariaLabel: el.getAttribute("aria-label") ?? "",
		dataAttrs: collectDataAttrs(el),
		className: classNameOf(el),
		rect: {
			x: Math.round(r.x),
			y: Math.round(r.y),
			w: Math.round(r.width),
			h: Math.round(r.height),
		},
		source: reactSource(el),
	};
}

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------

/** Short selector for the section title: component name if known, else last selector segment. */
function shortLabel(item: FeedbackItem): string {
	if (item.source?.componentName) return `<${item.source.componentName}>`;
	const segs = item.selector.split(">").map((s) => s.trim());
	return segs[segs.length - 1] || item.tag;
}

function esc(s: string): string {
	// Keep markdown readable; collapse newlines in inline fields.
	return s.replace(/\r?\n/g, " ").trim();
}

/** Format the collected items as a Markdown document an engineer can act on. */
export function toMarkdown(items: FeedbackItem[]): string {
	const lines: string[] = [];
	lines.push("# Esperanza Admin — Feedback");
	lines.push("");
	lines.push(`_Generated ${new Date().toISOString()} · ${items.length} note${items.length === 1 ? "" : "s"}_`);
	lines.push("");

	items.forEach((item, i) => {
		const idx = i + 1;
		lines.push(`## [${idx}] ${item.route || "/"} — ${shortLabel(item)}`);
		lines.push(`- when: ${item.iso}`);
		lines.push(`- selector: \`${item.selector}\``);

		const attrBits: string[] = [];
		if (item.role) attrBits.push(`role=${item.role}`);
		if (item.ariaLabel) attrBits.push(`aria=${item.ariaLabel}`);
		if (item.id) attrBits.push(`id=${item.id}`);
		const attrStr = attrBits.length ? ` (${attrBits.join(" ")})` : "";
		const textStr = item.text ? ` "${esc(item.text)}"` : "";
		lines.push(`- element: ${item.tag}${textStr}${attrStr}`);

		if (item.className) lines.push(`- classes: \`${item.className}\``);

		const dataKeys = Object.keys(item.dataAttrs);
		if (dataKeys.length) {
			const ds = dataKeys.map((k) => `${k}="${item.dataAttrs[k]}"`).join(" ");
			lines.push(`- data: \`${ds}\``);
		}

		if (item.source) {
			if (item.source.fileName) {
				const loc = item.source.lineNumber
					? `${item.source.fileName}:${item.source.lineNumber}`
					: item.source.fileName;
				lines.push(`- source: ${loc}`);
			} else if (item.source.componentName) {
				lines.push(`- source: <${item.source.componentName}>`);
			}
		}

		lines.push(`- rect: ${item.rect.x},${item.rect.y} ${item.rect.w}×${item.rect.h}`);
		lines.push(`- NOTE: ${esc(item.note)}`);
		lines.push("");
	});

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// File save: File System Access API, with download / clipboard fallbacks.
// ---------------------------------------------------------------------------

const SUGGESTED_NAME = "admin-feedback.md";

// Minimal typing for the File System Access API (not in lib.dom for all TS versions).
interface FSWritable {
	write(data: string | Blob): Promise<void>;
	close(): Promise<void>;
}
interface FSFileHandle {
	createWritable(): Promise<FSWritable>;
}
type ShowSaveFilePicker = (opts?: {
	suggestedName?: string;
	types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<FSFileHandle>;

// Module-scoped handle: once the reviewer picks a file, we keep rewriting it.
let fileHandle: FSFileHandle | null = null;

/** True when the browser supports the File System Access save picker. */
export function supportsFsSave(): boolean {
	return typeof window !== "undefined" && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/** True once a file handle has been chosen this session. */
export function hasFileHandle(): boolean {
	return fileHandle !== null;
}

/** Prompt the OS save dialog once and cache the handle in module state. */
export async function getFileHandle(): Promise<FSFileHandle | null> {
	if (fileHandle) return fileHandle;
	const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
	if (typeof picker !== "function") return null;
	fileHandle = await picker({
		suggestedName: SUGGESTED_NAME,
		types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
	});
	return fileHandle;
}

/** Rewrite the full markdown to the chosen file handle (prompting on first use). */
export async function saveToFile(items: FeedbackItem[]): Promise<boolean> {
	const handle = await getFileHandle();
	if (!handle) return false;
	const writable = await handle.createWritable();
	await writable.write(toMarkdown(items));
	await writable.close();
	return true;
}

/** Fallback: download the markdown as a file via a temporary <a download>. */
export function downloadMd(items: FeedbackItem[]): void {
	if (typeof document === "undefined") return;
	const blob = new Blob([toMarkdown(items)], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = SUGGESTED_NAME;
	a.style.display = "none";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Revoke on next tick so the download has time to start.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fallback: copy the markdown to the clipboard. Returns success. */
export async function copyMd(items: FeedbackItem[]): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.clipboard) return false;
	try {
		await navigator.clipboard.writeText(toMarkdown(items));
		return true;
	} catch {
		return false;
	}
}
