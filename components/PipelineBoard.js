"use client";
// Drag-and-drop pipeline board. Cards move between stages and can be ranked
// inside a stage. Every drop writes straight to Neon; the UI updates first and
// rolls back if the write fails.
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove,
  verticalListSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";
import {
  STAGES, BOARD_STAGES, STAGE_COLORS, STAGE_HINTS,
  normStage, isOpen, daysInStage, stageHealth,
} from "@/lib/pipeline";

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const compact = (n) => (n >= 1000 ? "$" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k" : money(n));
const HEALTH_COLOR = { ok: "var(--faint)", warn: "var(--amber)", stale: "var(--red)" };

// Build { stage: [projectId, ...] } ordered by manual rank, then deal size.
function groupByStage(projects) {
  const g = {};
  STAGES.forEach((s) => (g[s] = []));
  projects
    .slice()
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (num(b.deal) - num(a.deal)) || a.client.localeCompare(b.client))
    .forEach((p) => {
      const s = normStage(p.work);
      (g[s] = g[s] || []).push(p.id);
    });
  return g;
}

export default function PipelineBoard({ projects, onBoardChange, onOpen, showToast }) {
  const byId = useMemo(() => {
    const m = {};
    projects.forEach((p) => (m[p.id] = p));
    return m;
  }, [projects]);

  const [cols, setCols] = useState(() => groupByStage(projects));
  const [activeId, setActiveId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [lostPrompt, setLostPrompt] = useState(null); // { id, reason }

  // Re-derive columns from the server data whenever it changes, but never
  // mid-drag (that would yank the card out from under the cursor).
  useEffect(() => {
    if (!dragging) setCols(groupByStage(projects));
  }, [projects, dragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findColumn = useCallback(
    (id) => {
      if (STAGES.includes(id)) return id;
      return STAGES.find((s) => (cols[s] || []).includes(id));
    },
    [cols]
  );

  function handleDragStart(e) {
    setActiveId(e.active.id);
    setDragging(true);
  }

  function handleDragOver(e) {
    const { active, over } = e;
    if (!over) return;
    const from = findColumn(active.id);
    const to = findColumn(over.id);
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const src = (prev[from] || []).filter((x) => x !== active.id);
      const dst = (prev[to] || []).slice();
      const overIdx = dst.indexOf(over.id);
      dst.splice(overIdx >= 0 ? overIdx : dst.length, 0, active.id);
      return { ...prev, [from]: src, [to]: dst };
    });
  }

  async function handleDragEnd(e) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) { setDragging(false); setCols(groupByStage(projects)); return; }

    const to = findColumn(over.id);
    if (!to) { setDragging(false); return; }

    // Settle the final order inside the destination column.
    let finalCols = cols;
    const list = cols[to] || [];
    const oldIdx = list.indexOf(active.id);
    const newIdx = list.indexOf(over.id);
    if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
      finalCols = { ...cols, [to]: arrayMove(list, oldIdx, newIdx) };
      setCols(finalCols);
    }

    const originalStage = normStage(byId[active.id] ? byId[active.id].work : "Lead");
    setDragging(false);

    // Renumber the destination column so ranks stay clean integers.
    const moves = (finalCols[to] || []).map((id, i) => ({ id, work: to, sortOrder: i }));
    const changedStage = originalStage !== to;

    const ok = await onBoardChange(moves);
    if (!ok) return;
    if (changedStage) {
      const p = byId[active.id];
      showToast(`${p ? p.client : "Project"} → ${to}`);
      if (to === "Lost") setLostPrompt({ id: active.id, reason: "" });
    }
  }

  const visibleStages = showLost ? [...BOARD_STAGES, "Lost"] : BOARD_STAGES;
  const openValue = projects.filter((p) => isOpen(p.work)).reduce((s, p) => s + Math.max(num(p.deal) - num(p.paid), 0), 0);
  const lostCount = (cols.Lost || []).length;
  const stale = projects.filter((p) => stageHealth(p) === "stale").length;

  return (
    <section className="view">
      <div className="board-bar">
        <div className="board-stat">
          <span className="bs-label">Open pipeline</span>
          <span className="bs-val" style={{ color: "var(--blue)" }}>{money(openValue)}</span>
        </div>
        <div className="board-stat">
          <span className="bs-label">Stuck</span>
          <span className="bs-val" style={{ color: stale ? "var(--red)" : "var(--faint)" }}>
            {stale} past due in stage
          </span>
        </div>
        <div className="board-bar-right">
          <button className={"btn sm" + (showLost ? " primary" : "")} onClick={() => setShowLost((v) => !v)}>
            {showLost ? "Hide" : "Show"} Lost{lostCount ? ` (${lostCount})` : ""}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setActiveId(null); setDragging(false); setCols(groupByStage(projects)); }}
      >
        <div className="board">
          {visibleStages.map((stage) => (
            <Column
              key={stage}
              stage={stage}
              ids={cols[stage] || []}
              byId={byId}
              onOpen={onOpen}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.22,1,.36,1)" }}>
          {activeId && byId[activeId] ? <Card p={byId[activeId]} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <AnimatePresence>
        {lostPrompt && (
          <LostReason
            project={byId[lostPrompt.id]}
            onClose={() => setLostPrompt(null)}
            onSave={async (reason) => {
              const p = byId[lostPrompt.id];
              setLostPrompt(null);
              if (!p) return;
              await fetch(`/api/projects/${p.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...p, work: "Lost", lostReason: reason }),
              });
              showToast("Reason saved");
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

// ---------- Column ----------
function Column({ stage, ids, byId, onOpen }) {
  const color = STAGE_COLORS[stage];
  const cards = ids.map((id) => byId[id]).filter(Boolean);
  const value = cards.reduce((s, p) => s + (stage === "Recurring" ? num(p.mrr) : num(p.deal)), 0);
  // The column itself is a drop target, so an empty stage still accepts cards.
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { type: "column" } });

  return (
    <div className={"board-col" + (stage === "Lost" ? " is-lost" : "")}>
      <div className="col-head" style={{ borderTopColor: color }}>
        <div className="col-title">
          <span className="col-dot" style={{ background: color }} />
          {stage}
          <span className="col-count">{cards.length}</span>
        </div>
        <div className="col-value" style={{ color: value > 0 ? (stage === "Recurring" ? "var(--green)" : "var(--muted)") : "var(--faint)" }}>
          {value > 0 ? compact(value) + (stage === "Recurring" ? "/mo" : "") : "—"}
        </div>
        <div className="col-hint">{STAGE_HINTS[stage]}</div>
      </div>
      <SortableContext id={stage} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={"col-body" + (isOver ? " over" : "")}>
          {cards.length === 0 ? (
            <div className="col-empty">Drop here</div>
          ) : (
            cards.map((p) => <SortableCard key={p.id} p={p} onOpen={onOpen} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ---------- Card ----------
function SortableCard({ p, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card p={p} onOpen={onOpen} />
    </div>
  );
}

function Card({ p, onOpen, overlay }) {
  const d = daysInStage(p);
  const health = stageHealth(p);
  const out = Math.max(num(p.deal) - num(p.paid), 0);
  return (
    <div
      className={"pcard" + (overlay ? " overlay" : "")}
      onClick={(e) => { if (onOpen) { e.stopPropagation(); onOpen(p); } }}
    >
      <div className="pcard-top">
        <div className="pcard-name">{p.client || "(no name)"}</div>
        {num(p.deal) > 0 && <div className="pcard-deal">{compact(num(p.deal))}</div>}
      </div>
      {(p.project || p.niche) && (
        <div className="pcard-sub">{[p.project, p.niche].filter(Boolean).join(" · ")}</div>
      )}
      <div className="pcard-foot">
        {health && d != null && (
          <span className="pcard-age" style={{ color: HEALTH_COLOR[health] }}>
            {d === 0 ? "today" : d + "d in stage"}
          </span>
        )}
        {num(p.mrr) > 0 && <span className="pcard-mrr">{money(num(p.mrr))}/mo</span>}
        {out > 0 && num(p.paid) > 0 && <span className="pcard-out">{compact(out)} due</span>}
        {p.refby && <span className="pcard-ref">via {p.refby}</span>}
      </div>
      {p.lostReason ? <div className="pcard-lost">{p.lostReason}</div> : null}
    </div>
  );
}

// ---------- Lost reason prompt ----------
function LostReason({ project, onClose, onSave }) {
  const [reason, setReason] = useState("");
  const presets = ["Price", "Went with someone else", "Ghosted", "Bad fit", "Timing"];
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="modal small"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18 }}
      >
        <div className="modal-head">
          <h3>Why did {project ? project.client : "this"} go cold?</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="preset-row">
            {presets.map((x) => (
              <button key={x} type="button" className={"preset" + (reason === x ? " on" : "")} onClick={() => setReason(x)}>
                {x}
              </button>
            ))}
          </div>
          <div className="field full">
            <label>Reason <span className="hint">optional, but it makes win rate real</span></label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Budget came in at half" />
          </div>
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Skip</button>
          <button className="btn primary" onClick={() => onSave(reason.trim())}>Save reason</button>
        </div>
      </motion.div>
    </div>
  );
}
