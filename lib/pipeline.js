// ---------------------------------------------------------------------------
// The pipeline: one source of truth for stages, colors, ordering and aging.
// Imported by the DB layer, the table, the board and analytics so they can
// never drift apart.
// ---------------------------------------------------------------------------

export const STAGES = [
  "Lead",
  "Meeting",
  "Proposal",
  "In Progress",
  "In Review",
  "Domain",
  "Complete",
  "Recurring",
  "Lost",
];

// Stages that live on the Kanban board, left to right. Lost is parked off to
// the side so dead deals never pad the working pipeline.
export const BOARD_STAGES = STAGES.filter((s) => s !== "Lost");

export const STAGE_COLORS = {
  Lead: "#8b909b",
  Meeting: "#4dd4c0",
  Proposal: "#58a6ff",
  "In Progress": "#7c8cff",
  "In Review": "#bc8cff",
  Domain: "#d29922",
  Complete: "#3fb950",
  Recurring: "#e3b341",
  Lost: "#f0603a",
};

// One line each, shown on the board column headers so the meaning of a stage
// is never ambiguous six months from now.
export const STAGE_HINTS = {
  Lead: "Interested, no call booked",
  Meeting: "Discovery call booked or held",
  Proposal: "Quote sent, waiting on yes",
  "In Progress": "Deposit in, building",
  "In Review": "With the client for revisions",
  Domain: "Approved, waiting on domain / DNS",
  Complete: "Launched, one-time job",
  Recurring: "Launched, retainer billing",
  Lost: "Dead. Excluded from pipeline value.",
};

// How long a project should sit in a stage before it counts as stale. Anything
// past this turns amber on the board, past 2x turns red.
export const STAGE_SLA_DAYS = {
  Lead: 7,
  Meeting: 5,
  Proposal: 7,
  "In Progress": 21,
  "In Review": 7,
  Domain: 5,
  Complete: 0,     // 0 = never ages, the work is finished
  Recurring: 0,
  Lost: 0,
};

// Every historical status name, folded into the stage list above so old rows
// and old JSON backups keep working with zero manual cleanup.
export const LEGACY_STAGES = {
  "Payment Pending": "Proposal",
  "On Hold": "In Progress",
  Launched: "Complete",
  Won: "Complete",
  Dead: "Lost",
  Declined: "Lost",
};

export function normStage(w) {
  if (STAGES.includes(w)) return w;
  return LEGACY_STAGES[w] || "Lead";
}

// Shipped work: the build is out the door.
export const isDone = (w) => {
  const s = normStage(w);
  return s === "Complete" || s === "Recurring";
};
export const isLost = (w) => normStage(w) === "Lost";
export const isRecurring = (w) => normStage(w) === "Recurring";
// Open = still moving through the pipeline. Not shipped, not dead.
export const isOpen = (w) => !isDone(w) && !isLost(w);

export const stageIndex = (w) => STAGES.indexOf(normStage(w));

// --- aging -----------------------------------------------------------------
export function daysInStage(p) {
  if (!p || !p.stageAt) return null;
  const d = new Date(p.stageAt);
  if (isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// "ok" | "warn" | "stale" | null (null = this stage doesn't age)
export function stageHealth(p) {
  const stage = normStage(p.work);
  const sla = STAGE_SLA_DAYS[stage];
  if (!sla) return null;
  const d = daysInStage(p);
  if (d == null) return null;
  if (d >= sla * 2) return "stale";
  if (d >= sla) return "warn";
  return "ok";
}

// --- targets -----------------------------------------------------------------
// The numbers the business is actually being measured against.
export const MONTHLY_TARGET = 10000;   // $10k/month all-in, current goal
export const DEAL_FLOOR = 2500;        // qualification floor from the playbook
export const RETAINER_TIERS = [199, 399];

// Client work vs contractor paychecks. Only 'client' rows count toward the
// client metrics (MRR, average deal, retainer attach rate); both count toward
// total personal income.
export const INCOME_TYPES = ["client", "contractor"];
export const isClient = (p) => (p.incomeType || "client") !== "contractor";

// The acquisition funnel, in order. Delivery stages sit after the deal is won,
// so conversion is measured only across the stages before the money is committed.
export const FUNNEL = ["Lead", "Meeting", "Proposal", "In Progress"];
