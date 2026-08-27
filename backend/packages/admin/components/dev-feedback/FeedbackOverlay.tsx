"use client";

// components/dev-feedback/FeedbackOverlay.tsx
//
// DEV-ONLY visual feedback overlay. INERT by default: renders `null` until a
// reviewer activates it (Cmd/Ctrl+Shift+K, ?feedback=1, or the floating button).
// When inactive there is no DOM, no listeners on the page, no perf cost, and no
// interference with normal authenticated admin use.
//
// All overlay DOM carries `data-feedback-ui` so the hover/click capture ignores
// the overlay's own UI. This component only imports the pure helpers in
// lib/dev-feedback/capture.ts — no server-only modules.

import { useCallback, useEffect, useRef, useState } from "react";
import {
	copyMd,
	describe,
	downloadMd,
	type FeedbackItem,
	saveToFile,
	supportsFsSave,
	uniqueSelector,
} from "@/lib/dev-feedback/capture";

const LS_MODE = "esp-feedback-mode";
const LS_ITEMS = "esp-feedback-items";
const BRAND = "#2f5d4a"; // --color-brand
const BRAND_FILL = "rgba(47, 93, 74, 0.10)";

// ---------------------------------------------------------------------------
// localStorage helpers (guarded — never throw, never run server-side)
// ---------------------------------------------------------------------------

function readItems(): FeedbackItem[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(LS_ITEMS);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as FeedbackItem[]) : [];
	} catch {
		return [];
	}
}

function writeItems(items: FeedbackItem[]) {
	try {
		window.localStorage.setItem(LS_ITEMS, JSON.stringify(items));
	} catch {
		/* ignore quota / private-mode errors */
	}
}

function readMode(): boolean {
	if (typeof window === "undefined") return false;
	try {
		if (window.localStorage.getItem(LS_MODE) === "1") return true;
	} catch {
		/* ignore */
	}
	try {
		return new URLSearchParams(window.location.search).get("feedback") === "1";
	} catch {
		return false;
	}
}

// True if the node (or an ancestor) is part of the overlay's own UI.
function isOverlayUi(node: Element | null): boolean {
	let el: Element | null = node;
	while (el) {
		if (el instanceof HTMLElement && el.hasAttribute("data-feedback-ui")) return true;
		el = el.parentElement;
	}
	return false;
}

interface Highlight {
	rect: { x: number; y: number; w: number; h: number };
	label: string;
}

interface PopoverState {
	el: Element;
	rect: { x: number; y: number; w: number; h: number };
}

export function FeedbackOverlay() {
	const [active, setActive] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [items, setItems] = useState<FeedbackItem[]>([]);
	const [highlight, setHighlight] = useState<Highlight | null>(null);
	const [popover, setPopover] = useState<PopoverState | null>(null);
	const [panelOpen, setPanelOpen] = useState(true);
	const [note, setNote] = useState("");
	const [toast, setToast] = useState<string | null>(null);

	const captureRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | null>(null);
	const lastTargetRef = useRef<Element | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// --- Mount: hydrate activation + persisted notes, wire the hotkey ---------
	useEffect(() => {
		setMounted(true);
		setActive(readMode());
		setItems(readItems());

		function onKey(e: KeyboardEvent) {
			// Cmd/Ctrl + Shift + K toggles feedback mode.
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "K" || e.key === "k")) {
				e.preventDefault();
				setActive((prev) => {
					const next = !prev;
					try {
						window.localStorage.setItem(LS_MODE, next ? "1" : "0");
					} catch {
						/* ignore */
					}
					return next;
				});
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Persist activation whenever it changes (covers button + query-driven turns).
	useEffect(() => {
		if (!mounted) return;
		try {
			window.localStorage.setItem(LS_MODE, active ? "1" : "0");
		} catch {
			/* ignore */
		}
		if (!active) {
			// Leaving feedback mode clears transient selection/highlight state.
			setHighlight(null);
			setPopover(null);
			setNote("");
		}
	}, [active, mounted]);

	const flashToast = useCallback((msg: string) => {
		setToast(msg);
		window.setTimeout(() => setToast(null), 1800);
	}, []);

	// --- Read the element under the cursor, seeing *through* the capture layer.
	const elementUnderPoint = useCallback((clientX: number, clientY: number): Element | null => {
		const layer = captureRef.current;
		const prevPe = layer?.style.pointerEvents;
		if (layer) layer.style.pointerEvents = "none";
		const el = document.elementFromPoint(clientX, clientY);
		if (layer) layer.style.pointerEvents = prevPe ?? "";
		if (!el || isOverlayUi(el)) return null;
		return el;
	}, []);

	// --- Hover highlight (throttled via rAF) ----------------------------------
	const onMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (popover) return; // selection frozen while commenting
			const { clientX, clientY } = e;
			if (rafRef.current != null) return;
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = null;
				const el = elementUnderPoint(clientX, clientY);
				if (!el) {
					lastTargetRef.current = null;
					setHighlight(null);
					return;
				}
				lastTargetRef.current = el;
				const r = el.getBoundingClientRect();
				const rawText = (el as HTMLElement).innerText ?? el.textContent ?? "";
				const text = rawText.replace(/\s+/g, " ").trim().slice(0, 30);
				const sel = uniqueSelector(el);
				const shortSel = sel.split(">").map((s) => s.trim()).pop() || el.tagName.toLowerCase();
				const label = `${el.tagName.toLowerCase()} · ${shortSel}${text ? ` · "${text}"` : ""}`;
				setHighlight({
					rect: { x: r.x, y: r.y, w: r.width, h: r.height },
					label,
				});
			});
		},
		[elementUnderPoint, popover],
	);

	// --- Click a target: freeze selection, open the comment popover -----------
	const onCaptureClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const el = elementUnderPoint(e.clientX, e.clientY) ?? lastTargetRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			setPopover({ el, rect: { x: r.x, y: r.y, w: r.width, h: r.height } });
			setHighlight({
				rect: { x: r.x, y: r.y, w: r.width, h: r.height },
				label: uniqueSelector(el),
			});
			setNote("");
		},
		[elementUnderPoint],
	);

	// Autofocus the textarea when a popover opens.
	useEffect(() => {
		if (popover) {
			// next frame so the element exists
			const id = requestAnimationFrame(() => textareaRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
	}, [popover]);

	const saveNote = useCallback(() => {
		if (!popover) return;
		const trimmed = note.trim();
		if (!trimmed) {
			setPopover(null);
			setHighlight(null);
			return;
		}
		const item: FeedbackItem = {
			...describe(popover.el),
			note: trimmed,
			iso: new Date().toISOString(),
		};
		setItems((prev) => {
			const next = [...prev, item];
			writeItems(next);
			return next;
		});
		setPopover(null);
		setHighlight(null);
		setNote("");
		flashToast("Note saved");
	}, [popover, note, flashToast]);

	const cancelNote = useCallback(() => {
		setPopover(null);
		setHighlight(null);
		setNote("");
	}, []);

	const removeItem = useCallback((idx: number) => {
		setItems((prev) => {
			const next = prev.filter((_, i) => i !== idx);
			writeItems(next);
			return next;
		});
	}, []);

	const clearAll = useCallback(() => {
		setItems([]);
		writeItems([]);
		flashToast("Cleared");
	}, [flashToast]);

	const onSaveToFile = useCallback(async () => {
		try {
			if (supportsFsSave()) {
				const ok = await saveToFile(items);
				flashToast(ok ? "Saved to .md" : "Save cancelled");
			} else {
				downloadMd(items);
				flashToast("Downloaded .md (picker unsupported)");
			}
		} catch {
			flashToast("Save failed");
		}
	}, [items, flashToast]);

	const onCopy = useCallback(async () => {
		const ok = await copyMd(items);
		flashToast(ok ? "Markdown copied" : "Copy failed");
	}, [items, flashToast]);

	const onDownload = useCallback(() => {
		downloadMd(items);
		flashToast("Downloaded .md");
	}, [items, flashToast]);

	// === INERT when off: render NOTHING. This is the key constraint. ==========
	if (!mounted || !active) return null;

	// Popover placement: below the element if room, else above; clamped to viewport.
	const popStyle: React.CSSProperties | null = popover
		? (() => {
				const pw = 280;
				const belowTop = popover.rect.y + popover.rect.h + 8;
				const placeBelow = belowTop + 160 < window.innerHeight;
				const top = placeBelow ? belowTop : Math.max(8, popover.rect.y - 168);
				const left = Math.min(Math.max(8, popover.rect.x), window.innerWidth - pw - 8);
				return { position: "fixed", top, left, width: pw };
			})()
		: null;

	return (
		<>
			{/* Full-viewport transparent capture layer. */}
			<div
				ref={captureRef}
				data-feedback-ui="capture-layer"
				onMouseMove={popover ? undefined : onMouseMove}
				onClick={onCaptureClick}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 2147483600,
					cursor: "crosshair",
					// While a popover is open, let it receive events; the layer still
					// blocks the page beneath so admin handlers can't fire.
					pointerEvents: popover ? "none" : "auto",
					background: "transparent",
				}}
			/>

			{/* Hover/selection highlight box + label chip. */}
			{highlight && (
				<div data-feedback-ui="highlight" style={{ position: "fixed", inset: 0, zIndex: 2147483601, pointerEvents: "none" }}>
					<div
						style={{
							position: "fixed",
							top: highlight.rect.y,
							left: highlight.rect.x,
							width: highlight.rect.w,
							height: highlight.rect.h,
							border: `2px solid ${BRAND}`,
							background: BRAND_FILL,
							borderRadius: 3,
							boxSizing: "border-box",
						}}
					/>
					<div
						style={{
							position: "fixed",
							top: Math.max(2, highlight.rect.y - 22),
							left: highlight.rect.x,
							maxWidth: 360,
							padding: "2px 6px",
							background: BRAND,
							color: "#fff",
							font: "500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
							borderRadius: 4,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					>
						{highlight.label}
					</div>
				</div>
			)}

			{/* Comment popover anchored near the selected element. */}
			{popover && popStyle && (
				<div
					data-feedback-ui="popover"
					style={{
						...popStyle,
						zIndex: 2147483646,
						background: "#fbfbf9",
						color: "#2a2723",
						border: "1px solid rgba(0,0,0,0.12)",
						borderRadius: 10,
						boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
						padding: 10,
						font: "13px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif",
					}}
					onClick={(e) => e.stopPropagation()}
				>
					<div style={{ fontWeight: 600, marginBottom: 6 }}>What should change here?</div>
					<textarea
						ref={textareaRef}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								saveNote();
							} else if (e.key === "Escape") {
								e.preventDefault();
								cancelNote();
							}
						}}
						placeholder="Describe the change…"
						rows={3}
						style={{
							width: "100%",
							boxSizing: "border-box",
							resize: "vertical",
							padding: "6px 8px",
							border: "1px solid rgba(0,0,0,0.18)",
							borderRadius: 6,
							font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
							outline: "none",
						}}
					/>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
						<span style={{ fontSize: 11, color: "#6f685f" }}>Enter to save, Esc to cancel</span>
						<div style={{ display: "flex", gap: 6 }}>
							<OverlayBtn onClick={cancelNote} variant="ghost">
								Cancel
							</OverlayBtn>
							<OverlayBtn onClick={saveNote} variant="primary">
								Save
							</OverlayBtn>
						</div>
					</div>
				</div>
			)}

			{/* Collapsible panel: count + list of notes + actions. */}
			<div
				data-feedback-ui="panel"
				style={{
					position: "fixed",
					right: 16,
					bottom: 64,
					width: panelOpen ? 320 : "auto",
					zIndex: 2147483645,
					font: "13px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif",
				}}
			>
				<div
					style={{
						background: "#fbfbf9",
						color: "#2a2723",
						border: "1px solid rgba(0,0,0,0.12)",
						borderRadius: 12,
						boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
						overflow: "hidden",
					}}
				>
					<button
						type="button"
						onClick={() => setPanelOpen((o) => !o)}
						style={{
							all: "unset",
							boxSizing: "border-box",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							width: "100%",
							padding: "8px 12px",
							cursor: "pointer",
							background: BRAND,
							color: "#fff",
							fontWeight: 600,
						}}
					>
						<span>Feedback · {items.length}</span>
						<span style={{ fontSize: 11, opacity: 0.85 }}>{panelOpen ? "▾" : "▸"}</span>
					</button>

					{panelOpen && (
						<div>
							<div style={{ maxHeight: 240, overflowY: "auto", padding: items.length ? "6px 0" : 0 }}>
								{items.length === 0 ? (
									<div style={{ padding: "12px", color: "#6f685f", fontSize: 12 }}>
										Hover an element and click to leave a note.
									</div>
								) : (
									items.map((item, i) => {
										const segs = item.selector.split(">").map((s) => s.trim());
										const shortSel = item.source?.componentName
											? `<${item.source.componentName}>`
											: segs[segs.length - 1] || item.tag;
										return (
											<div
												key={`${item.iso}-${i}`}
												style={{
													display: "flex",
													gap: 6,
													padding: "6px 12px",
													borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,0.06)",
												}}
											>
												<div style={{ flex: 1, minWidth: 0 }}>
													<div
														style={{
															font: "500 11px/1.3 ui-monospace, Menlo, monospace",
															color: BRAND,
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
														}}
													>
														{item.route || "/"} · {shortSel}
													</div>
													<div style={{ fontSize: 12, color: "#2a2723", marginTop: 2 }}>{item.note}</div>
												</div>
												<button
													type="button"
													aria-label="Remove note"
													onClick={() => removeItem(i)}
													style={{
														all: "unset",
														cursor: "pointer",
														color: "#9a3b2e",
														fontSize: 14,
														lineHeight: 1,
														padding: "0 2px",
													}}
												>
													×
												</button>
											</div>
										);
									})
								)}
							</div>

							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									gap: 6,
									padding: "8px 12px",
									borderTop: "1px solid rgba(0,0,0,0.08)",
								}}
							>
								<OverlayBtn onClick={onSaveToFile} variant="primary" disabled={!items.length}>
									Save to .md
								</OverlayBtn>
								<OverlayBtn onClick={onCopy} disabled={!items.length}>
									Copy
								</OverlayBtn>
								<OverlayBtn onClick={onDownload} disabled={!items.length}>
									Download
								</OverlayBtn>
								<OverlayBtn onClick={clearAll} variant="danger" disabled={!items.length}>
									Clear all
								</OverlayBtn>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Floating toggle (only shown while ON — turns the overlay off). */}
			<button
				type="button"
				data-feedback-ui="toggle"
				aria-label="Exit feedback mode"
				onClick={() => setActive(false)}
				style={{
					all: "unset",
					boxSizing: "border-box",
					position: "fixed",
					right: 16,
					bottom: 16,
					zIndex: 2147483645,
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "8px 12px",
					background: BRAND,
					color: "#fff",
					borderRadius: 999,
					boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
					cursor: "pointer",
					font: "600 12px/1 ui-sans-serif, system-ui, sans-serif",
				}}
			>
				<span style={{ width: 8, height: 8, borderRadius: 999, background: "#fff" }} />
				Feedback ON — exit
			</button>

			{/* Transient toast. */}
			{toast && (
				<div
					data-feedback-ui="toast"
					style={{
						position: "fixed",
						left: "50%",
						bottom: 24,
						transform: "translateX(-50%)",
						zIndex: 2147483647,
						background: "#2a2723",
						color: "#fff",
						padding: "8px 14px",
						borderRadius: 8,
						font: "500 12px/1 ui-sans-serif, system-ui, sans-serif",
						boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
						pointerEvents: "none",
					}}
				>
					{toast}
				</div>
			)}
		</>
	);
}

// Tiny self-contained button so the overlay never depends on app styles.
function OverlayBtn({
	children,
	onClick,
	variant = "default",
	disabled = false,
}: {
	children: React.ReactNode;
	onClick: () => void;
	variant?: "default" | "primary" | "ghost" | "danger";
	disabled?: boolean;
}) {
	const base: React.CSSProperties = {
		all: "unset",
		boxSizing: "border-box",
		cursor: disabled ? "not-allowed" : "pointer",
		opacity: disabled ? 0.45 : 1,
		padding: "5px 10px",
		borderRadius: 6,
		font: "500 12px/1 ui-sans-serif, system-ui, sans-serif",
		border: "1px solid transparent",
	};
	const variants: Record<string, React.CSSProperties> = {
		default: { background: "#efeee9", color: "#2a2723", borderColor: "rgba(0,0,0,0.1)" },
		primary: { background: BRAND, color: "#fff" },
		ghost: { background: "transparent", color: "#2a2723", borderColor: "rgba(0,0,0,0.12)" },
		danger: { background: "rgba(154,59,46,0.10)", color: "#9a3b2e", borderColor: "rgba(154,59,46,0.2)" },
	};
	return (
		<button
			type="button"
			data-feedback-ui="btn"
			disabled={disabled}
			onClick={onClick}
			style={{ ...base, ...variants[variant] }}
		>
			{children}
		</button>
	);
}
