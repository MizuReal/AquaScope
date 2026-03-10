import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import Plot from "@/lib/Plot";
import { exportAnalyticsPdf } from "@/lib/api";

/* ── configuration ─────────────────────────────────────────────────────────── */

const configMissing = !supabase || !isSupabaseConfigured;

const FIELD_SAMPLES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";
const PROFILES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const CONTAINER_CANDIDATES = [
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE,
  import.meta.env.VITE_PUBLIC_CONTAINER_SAMPLES_TABLE,
  "container_scans",
  "container_samples",
].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);

const QUERY_TIMEOUT_MS = 15_000;
const ROW_LIMIT = 2000;

/* ── helpers ────────────────────────────────────────────────────────────────── */

function buildDayBuckets(rows, days = 30, dateField = "created_at") {
  const buckets = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      date: d,
      count: 0,
    });
  }
  rows.forEach((row) => {
    const d = row?.[dateField] ? new Date(row[dateField]) : null;
    if (!d || Number.isNaN(d.getTime())) return;
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const b = buckets.find((e) => e.key === k);
    if (b) b.count += 1;
  });
  return buckets;
}

function dateLbl(v) {
  const d = v instanceof Date ? v : v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "--";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function pct(v) {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "--";
}

function fmtDt(v) {
  if (!v) return "No data yet";
  return new Date(v).toLocaleString();
}

function countBy(arr, fn) {
  const m = {};
  arr.forEach((x) => {
    const k = fn(x) || "Unknown";
    m[k] = (m[k] || 0) + 1;
  });
  return m;
}

async function withTimeout(promise, ms, msg) {
  let tid;
  const tp = new Promise((_, rej) => {
    tid = setTimeout(() => rej(new Error(msg)), ms);
  });
  try {
    return await Promise.race([promise, tp]);
  } finally {
    clearTimeout(tid);
  }
}

const isMissingRelation = (e) =>
  e?.code === "42P01" || e?.code === "3F000";

async function resolveContainerTable() {
  for (const t of CONTAINER_CANDIDATES) {
    const { error } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true });
    if (!error) return t;
    if (isMissingRelation(error)) continue;
    return t;
  }
  return null;
}

function safeRows(res) {
  if (!res) return [];
  if (res.error && isMissingRelation(res.error)) return [];
  return res.data || [];
}

function formatReportTimestamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function buildReportFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `admin-analytics-report-${y}${m}${d}-${hh}${mm}.pdf`;
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const IconBot = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v3" />
    <circle cx="9" cy="13" r="1" />
    <circle cx="15" cy="13" r="1" />
    <path d="M9 16h6" />
  </svg>
);

/* ── component ──────────────────────────────────────────────────────────────── */

export default function AdminAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [fieldSamples, setFieldSamples] = useState([]);
  const [containerScans, setContainerScans] = useState([]);
  const [forumThreads, setForumThreads] = useState([]);
  const [forumPosts, setForumPosts] = useState([]);
  const [forumCategories, setForumCategories] = useState([]);
  const [threadCategories, setThreadCategories] = useState([]);
  const [likeCounts, setLikeCounts] = useState({ thread: 0, post: 0 });
  const [containerTableName, setContainerTableName] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const inflightRef = useRef(false);

  /* ── data loading ── */

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (configMissing || inflightRef.current) return;
    inflightRef.current = true;
    if (!silent) setLoading(true);
    setError("");

    try {
      const cTable = await withTimeout(
        resolveContainerTable(),
        QUERY_TIMEOUT_MS,
        "Container table resolution timed out.",
      );
      if (cTable) setContainerTableName(cTable);

      const results = await withTimeout(
        Promise.all([
          /* 0 */ supabase
            .from(PROFILES_TABLE)
            .select("id, created_at, status, role, organization")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          /* 1 */ supabase
            .from(FIELD_SAMPLES_TABLE)
            .select(
              "id, created_at, user_id, prediction_is_potable, prediction_probability, risk_level, microbial_risk, source",
            )
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          /* 2 */ cTable
            ? supabase
                .from(cTable)
                .select(
                  "id, created_at, user_id, predicted_class, confidence, is_valid",
                )
                .order("created_at", { ascending: false })
                .limit(ROW_LIMIT)
            : Promise.resolve({ data: [], error: null }),
          /* 3 */ supabase
            .from("forum_threads")
            .select("id, created_at, user_id, is_locked")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          /* 4 */ supabase
            .from("forum_posts")
            .select("id, created_at, thread_id, user_id, deleted_at")
            .order("created_at", { ascending: false })
            .limit(3000),
          /* 5 */ supabase
            .from("forum_categories")
            .select("id, slug, label, is_active"),
          /* 6 */ supabase
            .from("forum_thread_categories")
            .select("thread_id, category_id")
            .limit(5000),
          /* 7 */ supabase
            .from("forum_thread_likes")
            .select("*", { count: "exact", head: true }),
          /* 8 */ supabase
            .from("forum_post_likes")
            .select("*", { count: "exact", head: true }),
        ]),
        QUERY_TIMEOUT_MS + 5000,
        "Admin analytics fetch timed out.",
      );

      const [pR, fR, cR, tR, poR, catR, tcR, tlR, plR] = results;

      const hardError = [pR, fR]
        .map((r) => r.error)
        .filter((e) => e && !isMissingRelation(e))[0];
      if (hardError)
        throw new Error(hardError.message || "Failed to load analytics.");

      setProfiles(safeRows(pR));
      setFieldSamples(safeRows(fR));
      setContainerScans(safeRows(cR));
      setForumThreads(safeRows(tR));
      setForumPosts(safeRows(poR));
      setForumCategories(safeRows(catR));
      setThreadCategories(safeRows(tcR));
      setLikeCounts({
        thread: tlR?.count || 0,
        post: plR?.count || 0,
      });
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err?.message || "Unable to load admin analytics.");
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (configMissing) {
      setLoading(false);
      return;
    }
    loadData();
  }, [loadData]);

  /* ── computed analytics ── */

  const a = useMemo(() => {
    /* Users */
    const totalUsers = profiles.length;
    const activeUsers = profiles.filter((p) => p.status === "active").length;
    const deactivated = profiles.filter(
      (p) => p.status === "deactivated",
    ).length;
    const admins = profiles.filter((p) => Number(p.role) === 1).length;
    const activeRegular = profiles.filter(
      (p) => p.status === "active" && Number(p.role) !== 1,
    ).length;
    const activeRate = totalUsers > 0 ? activeUsers / totalUsers : 0;
    const regBuckets = buildDayBuckets(profiles, 30);
    const orgCounts = countBy(
      profiles,
      (p) => p.organization || "Unspecified",
    );
    const orgTop = Object.entries(orgCounts)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8);

    /* Field samples */
    const fsTotal = fieldSamples.length;
    const fsPotable = fieldSamples.filter(
      (s) => s.prediction_is_potable === true,
    ).length;
    const fsNonPotable = fieldSamples.filter(
      (s) => s.prediction_is_potable === false,
    ).length;
    const fsBuckets = buildDayBuckets(fieldSamples, 30);
    const riskCounts = countBy(
      fieldSamples.filter((s) => s.risk_level),
      (s) => String(s.risk_level).toLowerCase(),
    );
    const microCounts = countBy(
      fieldSamples.filter((s) => s.microbial_risk),
      (s) => String(s.microbial_risk).toLowerCase(),
    );
    const hasMicro = Object.keys(microCounts).length > 0;
    const confVals = fieldSamples
      .map((s) => Number(s.prediction_probability))
      .filter(Number.isFinite);
    const avgConf = confVals.length
      ? confVals.reduce((sum, v) => sum + v, 0) / confVals.length
      : null;
    const sourceCounts = countBy(
      fieldSamples.filter((s) => s.source),
      (s) => s.source,
    );
    const sourceTop = Object.entries(sourceCounts)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8);
    const fsContributors = new Set(
      fieldSamples.map((s) => s.user_id).filter(Boolean),
    ).size;

    /* Container scans */
    const csTotal = containerScans.length;
    const csValid = containerScans.filter(
      (s) => s.is_valid === true,
    ).length;
    const csInvalid = containerScans.filter(
      (s) => s.is_valid === false,
    ).length;
    const csBuckets = buildDayBuckets(containerScans, 30);
    const classTop = Object.entries(
      countBy(
        containerScans.filter((s) => s.predicted_class),
        (s) => s.predicted_class,
      ),
    ).sort((x, y) => y[1] - x[1]);
    const csConfVals = containerScans
      .map((s) => Number(s.confidence))
      .filter(Number.isFinite);
    const csContributors = new Set(
      containerScans.map((s) => s.user_id).filter(Boolean),
    ).size;

    /* Forum */
    const ftTotal = forumThreads.length;
    const ftLocked = forumThreads.filter((t) => t.is_locked).length;
    const fpTotal = forumPosts.length;
    const fpDeleted = forumPosts.filter((p) => p.deleted_at).length;
    const ftBuckets = buildDayBuckets(forumThreads, 30);
    const fpBuckets = buildDayBuckets(forumPosts, 30);
    const totalLikes = likeCounts.thread + likeCounts.post;
    const forumContribs = new Set(
      [...forumThreads.map((t) => t.user_id), ...forumPosts.map((p) => p.user_id)].filter(Boolean),
    ).size;
    const catMap = {};
    forumCategories.forEach((c) => {
      catMap[c.id] = c.label;
    });
    const catTop = Object.entries(
      countBy(threadCategories, (tc) => catMap[tc.category_id] || "Unknown"),
    ).sort((x, y) => y[1] - x[1]);
    const repliesPerThread =
      ftTotal > 0 ? (fpTotal - fpDeleted) / ftTotal : 0;

    /* Top contributors (cross-system) */
    const actMap = {};
    fieldSamples.forEach((s) => {
      if (s.user_id) actMap[s.user_id] = (actMap[s.user_id] || 0) + 1;
    });
    containerScans.forEach((s) => {
      if (s.user_id) actMap[s.user_id] = (actMap[s.user_id] || 0) + 1;
    });
    forumThreads.forEach((t) => {
      if (t.user_id) actMap[t.user_id] = (actMap[t.user_id] || 0) + 1;
    });
    forumPosts.forEach((p) => {
      if (p.user_id) actMap[p.user_id] = (actMap[p.user_id] || 0) + 1;
    });
    const topContribs = Object.entries(actMap)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 10)
      .map(([id, cnt]) => ({ label: id.slice(0, 8) + "\u2026", count: cnt }));

    return {
      totalUsers, activeUsers, deactivated, admins, activeRegular, activeRate,
      regBuckets, orgTop,
      fsTotal, fsPotable, fsNonPotable, fsBuckets, riskCounts,
      microCounts, hasMicro, confVals, avgConf, sourceTop, fsContributors,
      csTotal, csValid, csInvalid, csBuckets, classTop, csConfVals, csContributors,
      ftTotal, ftLocked, fpTotal, fpDeleted, ftBuckets, fpBuckets,
      totalLikes, forumContribs, catTop, repliesPerThread, topContribs,
    };
  }, [profiles, fieldSamples, containerScans, forumThreads, forumPosts, forumCategories, threadCategories, likeCounts]);

  const cardInsights = useMemo(() => ({
    registration: a.regBuckets.some((b) => b.count > 0)
      ? `Registration momentum shows ${a.regBuckets.reduce((sum, b) => sum + b.count, 0)} new users over the last 30 days.`
      : "No recent registrations yet; monitor onboarding channels for activation opportunities.",
    accountComposition: a.totalUsers > 0
      ? `Active rate is ${pct(a.activeRate)} with ${a.deactivated} deactivated accounts, so retention remains a key lever.`
      : "No user composition data available yet.",
    ingestion: a.fsTotal || a.csTotal
      ? `Field ingestion is ${a.fsTotal} samples and container ingestion is ${a.csTotal} scans, useful for balancing pipeline workload.`
      : "No ingestion records yet; submit data to unlock trend analysis.",
    potability: a.fsTotal > 0
      ? `${pct(a.fsPotable / a.fsTotal)} of field samples are potable, while ${a.fsNonPotable} samples need attention.`
      : "No potability outcomes available yet.",
    risk: Object.keys(a.riskCounts).length > 0
      ? "Watch and unsafe concentration should drive next-round verification and source tracing." 
      : "No risk-level assignments available yet.",
    fieldConfidence: a.confVals.length > 0
      ? `Average field-sample potability score is ${pct(a.avgConf)} across ${a.confVals.length} predictions; monitor dips below 70%.`
      : "No potability score values available yet.",
    classBreakdown: a.classTop.length > 0
      ? `Container classes show ${a.classTop[0][0]} as the most frequent output, useful for targeted quality audits.`
      : "No container class predictions available yet.",
    scanValidity: a.csTotal > 0
      ? `${a.csValid} valid scans vs ${a.csInvalid} invalid scans; reducing rejects will improve downstream analytics quality.`
      : "No scan validity data available yet.",
    containerConfidence: a.csConfVals.length > 0
      ? `Container model confidence is captured across ${a.csConfVals.length} scans; low-confidence tails indicate image quality issues.`
      : "No container confidence values available yet.",
    microbial: a.hasMicro
      ? "Microbial-risk mix helps prioritize intervention where medium/high contamination signals are rising."
      : "No microbial-risk records available yet.",
    forumActivity: a.ftTotal || a.fpTotal
      ? `Community activity totals ${a.ftTotal} threads and ${a.fpTotal} posts, with ${a.totalLikes} likes signaling engagement intensity.`
      : "No forum activity data available yet.",
    category: a.catTop.length > 0
      ? `${a.catTop[0][0]} is currently the most active category; use this to guide moderation and content planning.`
      : "No category-tag data available yet.",
    contributors: a.topContribs.length > 0
      ? "Top contributors reveal operational champions who can support quality and community initiatives."
      : "No contributor activity data available yet.",
    source: a.sourceTop.length > 0
      ? `${a.sourceTop[0][0]} is the leading sample source; source concentration can guide field prioritization.`
      : "No sample-source labels available yet.",
    organization: a.orgTop.length > 1
      ? "Organization distribution highlights where user adoption is strongest and where outreach may be needed."
      : "Organization distribution is not yet diverse enough for trend insights.",
  }), [a]);

  /* ── chart helpers ── */

  const plotCfg = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
    scrollZoom: false,
  };

  const lay = (o = {}) => ({
    autosize: true,
    margin: { l: 46, r: 16, t: 10, b: 42 },
    paper_bgcolor: "rgba(255,255,255,0)",
    plot_bgcolor: "#ffffff",
    ...o,
  });

  const pieLay = (h = 260) => ({
    autosize: true,
    height: h,
    margin: { l: 16, r: 16, t: 10, b: 10 },
    paper_bgcolor: "rgba(255,255,255,0)",
    showlegend: true,
    legend: { orientation: "h", y: -0.1, x: 0.1, font: { size: 11, color: "#475569" } },
  });

  const hasChartData =
    a.totalUsers > 0 ||
    a.fsTotal > 0 ||
    a.csTotal > 0 ||
    a.ftTotal > 0 ||
    a.fpTotal > 0 ||
    a.totalLikes > 0;

  const buildExportCharts = useCallback(() => {
    const charts = [];

    charts.push({
      title: "Registration trend (30 days)",
      subtitle: "New users per day.",
      insight: a.regBuckets.some((b) => b.count > 0)
        ? `Registrations in the last 30 days: ${a.regBuckets.reduce((sum, b) => sum + b.count, 0)}.`
        : "No registrations recorded in the last 30 days.",
      data: [
        {
          x: a.regBuckets.map((b) => dateLbl(b.date)),
          y: a.regBuckets.map((b) => b.count),
          type: "bar",
          marker: { color: "#0284c7" },
          name: "New users",
        },
      ],
      layout: lay({
        height: 300,
        xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
        yaxis: { title: "Users", rangemode: "tozero", dtick: 1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
        showlegend: false,
      }),
    });

    charts.push({
      title: "Account composition",
      subtitle: "Active, deactivated, and admin user segments.",
      insight: a.totalUsers > 0
        ? `Active rate is ${pct(a.activeRate)} with ${a.deactivated} deactivated accounts.`
        : "No user account data available.",
      data: [
        {
          labels: ["Active users", "Deactivated", "Admins"],
          values: [a.activeRegular, a.deactivated, a.admins],
          type: "pie",
          hole: 0.45,
          marker: { colors: ["#0ea5e9", "#94a3b8", "#6366f1"] },
          textinfo: "percent+label",
        },
      ],
      layout: pieLay(300),
    });

    charts.push({
      title: "Ingestion volume trend (30 days)",
      subtitle: "Field samples vs container scans per day.",
      insight:
        a.fsTotal || a.csTotal
          ? `Field samples: ${a.fsTotal}. Container scans: ${a.csTotal}.`
          : "No ingestion records available.",
      data: [
        {
          x: a.fsBuckets.map((b) => dateLbl(b.date)),
          y: a.fsBuckets.map((b) => b.count),
          type: "bar",
          name: "Field samples",
          marker: { color: "#7c3aed" },
        },
        {
          x: a.csBuckets.map((b) => dateLbl(b.date)),
          y: a.csBuckets.map((b) => b.count),
          type: "bar",
          name: "Container scans",
          marker: { color: "#f59e0b" },
        },
      ],
      layout: lay({
        height: 300,
        barmode: "group",
        xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
        yaxis: { title: "Count", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
        legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } },
      }),
    });

    charts.push({
      title: "Potability outcomes",
      subtitle: "Potable vs non-potable field sample classifications.",
      insight: a.fsTotal > 0
        ? `Potable share is ${pct(a.fsPotable / a.fsTotal)} across ${a.fsTotal} samples.`
        : "No field sample data available.",
      data: [
        {
          labels: ["Potable", "Non-potable"],
          values: [a.fsPotable, a.fsNonPotable],
          type: "pie",
          hole: 0.45,
          marker: { colors: ["#10b981", "#f43f5e"] },
          textinfo: "percent+label",
        },
      ],
      layout: pieLay(300),
    });

    if (Object.keys(a.riskCounts).length > 0) {
      charts.push({
        title: "Risk level distribution",
        subtitle: "Count by assigned field-sample risk level.",
        insight: "Use unsafe/watch concentration to prioritize follow-up sampling.",
        data: [
          {
            x: Object.keys(a.riskCounts),
            y: Object.values(a.riskCounts),
            type: "bar",
            marker: {
              color: Object.keys(a.riskCounts).map((k) => {
                if (k === "safe") return "#10b981";
                if (k === "borderline") return "#f59e0b";
                if (k === "watch") return "#f97316";
                if (k === "unsafe") return "#ef4444";
                return "#94a3b8";
              }),
            },
          },
        ],
        layout: lay({
          height: 300,
          xaxis: { title: "Risk level", tickfont: { size: 11, color: "#475569" } },
          yaxis: { title: "Samples", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          showlegend: false,
        }),
      });
    }

    if (a.confVals.length > 0) {
      charts.push({
        title: "Field potability score",
        subtitle: "Histogram of potability scores for field samples.",
        insight: `Average potability score is ${pct(a.avgConf)} across ${a.confVals.length} samples.`,
        data: [
          {
            x: a.confVals,
            type: "histogram",
            nbinsx: 20,
            marker: { color: "#6366f1", line: { color: "#4338ca", width: 1 } },
            name: "Potability",
          },
        ],
        layout: lay({
          height: 300,
          xaxis: { title: "Potability", range: [0, 1], tickfont: { size: 10, color: "#475569" } },
          yaxis: { title: "Frequency", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          showlegend: false,
        }),
      });
    }

    if (a.classTop.length > 0) {
      charts.push({
        title: "Container class breakdown",
        subtitle: "Distribution of predicted container classifications.",
        insight: `Container scans analyzed: ${a.csTotal}.`,
        data: [
          {
            y: a.classTop.map(([k]) => k),
            x: a.classTop.map(([, v]) => v),
            type: "bar",
            orientation: "h",
            marker: { color: "#d97706" },
            name: "Predicted class",
          },
        ],
        layout: lay({
          height: Math.max(260, a.classTop.length * 40),
          margin: { l: 120, r: 16, t: 10, b: 42 },
          xaxis: { title: "Count", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          yaxis: { tickfont: { size: 10, color: "#475569" }, automargin: true },
          showlegend: false,
        }),
      });
    }

    if (a.csTotal > 0) {
      charts.push({
        title: "Container scan validity",
        subtitle: "Valid vs invalid container scans.",
        insight: `Validity ratio: ${a.csValid} valid, ${a.csInvalid} invalid.`,
        data: [
          {
            labels: ["Valid", "Invalid"],
            values: [a.csValid, a.csInvalid],
            type: "pie",
            hole: 0.45,
            marker: { colors: ["#10b981", "#ef4444"] },
            textinfo: "percent+label",
          },
        ],
        layout: pieLay(280),
      });
    }

    if (a.csConfVals.length > 0) {
      charts.push({
        title: "Container confidence",
        subtitle: "Histogram of container model confidence scores.",
        insight: "Track low-confidence tails to improve image collection quality.",
        data: [
          {
            x: a.csConfVals,
            type: "histogram",
            nbinsx: 20,
            marker: { color: "#d97706", line: { color: "#b45309", width: 1 } },
            name: "Confidence",
          },
        ],
        layout: lay({
          height: 280,
          xaxis: { title: "Confidence", range: [0, 1], tickfont: { size: 10, color: "#475569" } },
          yaxis: { title: "Frequency", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          showlegend: false,
        }),
      });
    }

    charts.push({
      title: "Forum activity trend (30 days)",
      subtitle: "Threads and posts created per day.",
      insight: `Threads: ${a.ftTotal}, posts: ${a.fpTotal}, likes: ${a.totalLikes}.`,
      data: [
        {
          x: a.ftBuckets.map((b) => dateLbl(b.date)),
          y: a.ftBuckets.map((b) => b.count),
          type: "bar",
          name: "Threads",
          marker: { color: "#059669" },
        },
        {
          x: a.fpBuckets.map((b) => dateLbl(b.date)),
          y: a.fpBuckets.map((b) => b.count),
          type: "bar",
          name: "Posts",
          marker: { color: "#6ee7b7" },
        },
      ],
      layout: lay({
        height: 300,
        barmode: "stack",
        xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
        yaxis: { title: "Count", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
        legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } },
      }),
    });

    if (a.catTop.length > 0) {
      charts.push({
        title: "Forum category popularity",
        subtitle: "Thread distribution by category tags.",
        insight: `Locked threads: ${a.ftLocked}. Deleted posts: ${a.fpDeleted}.`,
        data: [
          {
            y: a.catTop.map(([k]) => k),
            x: a.catTop.map(([, v]) => v),
            type: "bar",
            orientation: "h",
            marker: { color: "#059669" },
            name: "Threads",
          },
        ],
        layout: lay({
          height: Math.max(240, a.catTop.length * 40),
          margin: { l: 100, r: 16, t: 10, b: 42 },
          xaxis: { title: "Threads", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          yaxis: { tickfont: { size: 10, color: "#475569" }, automargin: true },
          showlegend: false,
        }),
      });
    }

    if (a.topContribs.length > 0) {
      charts.push({
        title: "Top contributors",
        subtitle: "Most active users by combined actions across systems.",
        insight: `Unique contributors: ${a.forumContribs + a.fsContributors + a.csContributors} (cross-system, non-deduplicated roll-up).`,
        data: [
          {
            y: a.topContribs.map((c) => c.label),
            x: a.topContribs.map((c) => c.count),
            type: "bar",
            orientation: "h",
            marker: { color: "#0284c7" },
            name: "Actions",
          },
        ],
        layout: lay({
          height: Math.max(260, a.topContribs.length * 32),
          margin: { l: 90, r: 16, t: 10, b: 42 },
          xaxis: { title: "Total actions", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          yaxis: { tickfont: { size: 10, color: "#475569" }, autorange: "reversed" },
          showlegend: false,
        }),
      });
    }

    if (a.sourceTop.length > 0) {
      charts.push({
        title: "Sample source distribution",
        subtitle: "Origin/source labels in field samples.",
        insight: "Use source concentration to target specific field pipelines.",
        data: [
          {
            y: a.sourceTop.map(([k]) => k),
            x: a.sourceTop.map(([, v]) => v),
            type: "bar",
            orientation: "h",
            marker: { color: "#7c3aed" },
            name: "Samples",
          },
        ],
        layout: lay({
          height: Math.max(260, a.sourceTop.length * 36),
          margin: { l: 100, r: 16, t: 10, b: 42 },
          xaxis: { title: "Count", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          yaxis: { tickfont: { size: 10, color: "#475569" }, automargin: true },
          showlegend: false,
        }),
      });
    }

    if (a.hasMicro) {
      charts.push({
        title: "Microbial risk analysis",
        subtitle: "Distribution of microbial contamination risk levels.",
        insight: "Track high-risk microbial share to prioritize remediation workflows.",
        data: [
          {
            labels: Object.keys(a.microCounts).map((k) => k.charAt(0).toUpperCase() + k.slice(1)),
            values: Object.values(a.microCounts),
            type: "pie",
            hole: 0.45,
            marker: {
              colors: Object.keys(a.microCounts).map((k) => {
                if (k === "low") return "#10b981";
                if (k === "medium") return "#f59e0b";
                if (k === "high") return "#ef4444";
                return "#94a3b8";
              }),
            },
            textinfo: "percent+label",
          },
        ],
        layout: pieLay(300),
      });
    }

    if (a.orgTop.length > 1) {
      charts.push({
        title: "Organization distribution",
        subtitle: "User distribution by organization affiliation.",
        insight: `Top organizations represented: ${a.orgTop.length}.`,
        data: [
          {
            y: a.orgTop.map(([k]) => k),
            x: a.orgTop.map(([, v]) => v),
            type: "bar",
            orientation: "h",
            marker: { color: "#0284c7" },
            name: "Users",
          },
        ],
        layout: lay({
          height: Math.max(240, a.orgTop.length * 36),
          margin: { l: 120, r: 16, t: 10, b: 42 },
          xaxis: { title: "Users", rangemode: "tozero", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
          yaxis: { tickfont: { size: 10, color: "#475569" }, automargin: true },
          showlegend: false,
        }),
      });
    }

    return charts;
  }, [a, lay, pieLay]);

  const handleExportPdf = useCallback(async () => {
    if (exporting || loading || !hasChartData) return;
    setExportError("");
    setExporting(true);
    try {
      const now = new Date();
      const payload = {
        reportTitle: "Admin Analytics Report",
        generatedAt: formatReportTimestamp(now),
        summaryBadges: [
          `Total users: ${a.totalUsers}`,
          `Field samples: ${a.fsTotal}`,
          `Container scans: ${a.csTotal}`,
          `Forum threads: ${a.ftTotal}`,
          `Forum posts: ${a.fpTotal}`,
          `Total likes: ${a.totalLikes}`,
        ],
        chartsPerPage: 2,
        charts: buildExportCharts(),
      };
      const pdfBlob = await exportAnalyticsPdf(payload);
      triggerBlobDownload(pdfBlob, buildReportFileName(now));
    } catch (exportErr) {
      setExportError(exportErr?.message || "Unable to export admin analytics PDF.");
    } finally {
      setExporting(false);
    }
  }, [a, buildExportCharts, exporting, hasChartData, loading]);

  /* ── render ── */

  if (configMissing) {
    return (
      <section className="flex-1 px-6 py-10 lg:px-12">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Supabase is not configured. Add VITE_PUBLIC_SUPABASE_URL and
          VITE_PUBLIC_SUPABASE_ANON_KEY in .env.local.
        </p>
      </section>
    );
  }

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      {/* ── Header ── */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">
            Admin Analytics
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">
            Platform-Wide Intelligence
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Comprehensive analytics across users, data ingestion, container
            scans, and community engagement.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={loading || exporting || !hasChartData}
            className="rounded-full border border-violet-300 bg-violet-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
          >
            {exporting ? "Exporting\u2026" : "Export PDF"}
          </button>
          <button
            type="button"
            onClick={() => loadData()}
            disabled={loading}
            className="rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 transition hover:bg-sky-100 disabled:opacity-50"
          >
            {loading ? "Refreshing\u2026" : "Refresh"}
          </button>
          <span className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm text-slate-700">
            {loading ? "Loading data\u2026" : `Updated: ${fmtDt(updatedAt)}`}
          </span>
        </div>
      </header>

      {error && (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {exportError && (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {exportError}
        </p>
      )}

      {loading ? (
        <div className="mt-10 rounded-2xl border border-sky-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading platform analytics\u2026
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="mt-10 rounded-2xl border border-sky-200 bg-white p-8 text-center text-sm text-slate-500">
              Loading charts\u2026
            </div>
          }
        >
          {/* ── KPI Cards ── */}
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              {
                label: "Total users",
                value: a.totalUsers,
                sub: `${a.activeUsers} active`,
                border: "border-sky-300",
                gradient: "from-sky-50",
                accent: "text-sky-600",
              },
              {
                label: "Active rate",
                value: pct(a.activeRate),
                sub: `${a.deactivated} deactivated`,
                border: "border-emerald-300",
                gradient: "from-emerald-50",
                accent: "text-emerald-600",
              },
              {
                label: "Field samples",
                value: a.fsTotal,
                sub: `${a.fsContributors} contributors`,
                border: "border-violet-300",
                gradient: "from-violet-50",
                accent: "text-violet-600",
              },
              {
                label: "Container scans",
                value: a.csTotal,
                sub: `${a.csContributors} contributors`,
                border: "border-amber-300",
                gradient: "from-amber-50",
                accent: "text-amber-600",
              },
              {
                label: "Forum threads",
                value: a.ftTotal,
                sub: `${a.fpTotal} replies`,
                border: "border-fuchsia-300",
                gradient: "from-fuchsia-50",
                accent: "text-fuchsia-600",
              },
              {
                label: "Total likes",
                value: a.totalLikes,
                sub: `${a.forumContribs} contributors`,
                border: "border-teal-300",
                gradient: "from-teal-50",
                accent: "text-teal-600",
              },
            ].map((c) => (
              <article
                key={c.label}
                className={`rounded-2xl border-2 ${c.border} bg-gradient-to-br ${c.gradient} to-white p-5 shadow-sm`}
              >
                <p
                  className={`text-[10px] font-medium uppercase tracking-[0.35em] ${c.accent}`}
                >
                  {c.label}
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {c.value}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{c.sub}</p>
              </article>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════════════════
              Section: User Analytics
              ══════════════════════════════════════════════════════════ */}
          <article className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.35em] text-sky-700">
              User analytics
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Registration trends and account composition over the last 30 days.
            </p>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              {/* Registration trend */}
              <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-sky-900">
                    Registration trend
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    30 days
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  New user sign-ups per day.
                </p>
                {a.regBuckets.some((b) => b.count > 0) ? (
                  <>
                    <Plot
                      data={[
                        {
                          x: a.regBuckets.map((b) => dateLbl(b.date)),
                          y: a.regBuckets.map((b) => b.count),
                          type: "bar",
                          marker: { color: "#0284c7" },
                          hovertemplate:
                            "%{x}<br>New users: %{y}<extra></extra>",
                        },
                      ]}
                      layout={lay({
                        height: 260,
                        xaxis: {
                          title: "Day",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          title: "Users",
                          rangemode: "tozero",
                          dtick: 1,
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        showlegend: false,
                      })}
                      config={plotCfg}
                      useResizeHandler
                      style={{ width: "100%", height: "260px" }}
                    />
                    <div className="mt-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs text-sky-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.registration}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No registrations in the last 30 days.
                  </p>
                )}
              </div>

              {/* Account composition */}
              <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-sky-900">
                    Account composition
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    All users
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Active, deactivated, and admin breakdown.
                </p>
                {a.totalUsers > 0 ? (
                  <>
                    <Plot
                      data={[
                        {
                          labels: ["Active users", "Deactivated", "Admins"],
                          values: [a.activeRegular, a.deactivated, a.admins],
                          type: "pie",
                          hole: 0.45,
                          marker: {
                            colors: ["#0ea5e9", "#94a3b8", "#6366f1"],
                          },
                          textinfo: "percent+label",
                          hovertemplate:
                            "%{label}<br>Count: %{value}<br>%{percent}<extra></extra>",
                        },
                      ]}
                      layout={pieLay(260)}
                      config={plotCfg}
                      useResizeHandler
                      style={{ width: "100%", height: "260px" }}
                    />
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-sky-600">
                          Active
                        </p>
                        <p className="mt-1 font-semibold text-sky-700">
                          {a.activeUsers}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                          Deactivated
                        </p>
                        <p className="mt-1 font-semibold text-slate-600">
                          {a.deactivated}
                        </p>
                      </div>
                      <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-indigo-600">
                          Admins
                        </p>
                        <p className="mt-1 font-semibold text-indigo-700">
                          {a.admins}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs text-sky-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.accountComposition}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No user data.
                  </p>
                )}
              </div>
            </div>
          </article>

          {/* ══════════════════════════════════════════════════════════════
              Section: Data Ingestion
              ══════════════════════════════════════════════════════════ */}
          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.35em] text-violet-700">
              Data ingestion
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Field sample &amp; container scan volume, potability outcomes, and
              risk distribution.
            </p>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              {/* Combined ingestion volume */}
              <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-violet-900">
                    Ingestion volume trend
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    30 days
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Field samples vs container scans per day.
                </p>
                {a.fsBuckets.some((b) => b.count > 0) ||
                a.csBuckets.some((b) => b.count > 0) ? (
                  <>
                    <Plot
                      data={[
                        {
                          x: a.fsBuckets.map((b) => dateLbl(b.date)),
                          y: a.fsBuckets.map((b) => b.count),
                          type: "bar",
                          name: "Field samples",
                          marker: { color: "#7c3aed" },
                          hovertemplate:
                            "%{x}<br>Field: %{y}<extra></extra>",
                        },
                        {
                          x: a.csBuckets.map((b) => dateLbl(b.date)),
                          y: a.csBuckets.map((b) => b.count),
                          type: "bar",
                          name: "Container scans",
                          marker: { color: "#f59e0b" },
                          hovertemplate:
                            "%{x}<br>Container: %{y}<extra></extra>",
                        },
                      ]}
                      layout={lay({
                        height: 270,
                        barmode: "group",
                        xaxis: {
                          title: "Day",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          title: "Count",
                          rangemode: "tozero",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        legend: {
                          orientation: "h",
                          y: 1.14,
                          x: 0,
                          font: { size: 10, color: "#475569" },
                        },
                      })}
                      config={plotCfg}
                      useResizeHandler
                      style={{ width: "100%", height: "270px" }}
                    />
                    <div className="mt-2 rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs text-violet-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.ingestion}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No ingestion data in the last 30 days.
                  </p>
                )}
              </div>

              {/* Potability outcomes */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-emerald-900">
                    Potability outcomes
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    All field samples
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Potable vs non-potable classification.
                </p>
                {a.fsTotal > 0 ? (
                  <>
                    <Plot
                      data={[
                        {
                          labels: ["Potable", "Non-potable"],
                          values: [a.fsPotable, a.fsNonPotable],
                          type: "pie",
                          hole: 0.45,
                          marker: { colors: ["#10b981", "#f43f5e"] },
                          textinfo: "percent+label",
                          hovertemplate:
                            "%{label}<br>Count: %{value}<br>%{percent}<extra></extra>",
                        },
                      ]}
                      layout={pieLay(260)}
                      config={plotCfg}
                      useResizeHandler
                      style={{ width: "100%", height: "260px" }}
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-600">
                          Potable
                        </p>
                        <p className="mt-1 font-semibold text-emerald-700">
                          {a.fsPotable} (
                          {pct(a.fsTotal ? a.fsPotable / a.fsTotal : 0)})
                        </p>
                      </div>
                      <div className="rounded-lg border border-rose-200 bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-rose-600">
                          Non-potable
                        </p>
                        <p className="mt-1 font-semibold text-rose-700">
                          {a.fsNonPotable} (
                          {pct(a.fsTotal ? a.fsNonPotable / a.fsTotal : 0)})
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs text-emerald-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.potability}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No field sample data.
                  </p>
                )}
              </div>

              {/* Risk level distribution */}
              <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-rose-900">
                    Risk level distribution
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    Field samples
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Breakdown of assigned risk levels.
                </p>
                {Object.keys(a.riskCounts).length > 0 ? (
                  <>
                    <Plot
                      data={[
                        {
                          x: Object.keys(a.riskCounts),
                          y: Object.values(a.riskCounts),
                          type: "bar",
                          marker: {
                            color: Object.keys(a.riskCounts).map((k) => {
                              if (k === "safe") return "#10b981";
                              if (k === "borderline") return "#f59e0b";
                              if (k === "watch") return "#f97316";
                              if (k === "unsafe") return "#ef4444";
                              return "#94a3b8";
                            }),
                          },
                          text: Object.values(a.riskCounts).map(String),
                          textposition: "outside",
                          hovertemplate:
                            "%{x}<br>Count: %{y}<extra></extra>",
                        },
                      ]}
                      layout={lay({
                        height: 260,
                        xaxis: {
                          title: "Risk level",
                          tickfont: { size: 11, color: "#475569" },
                        },
                        yaxis: {
                          title: "Samples",
                          rangemode: "tozero",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        showlegend: false,
                      })}
                      config={plotCfg}
                      useResizeHandler
                      style={{ width: "100%", height: "260px" }}
                    />
                    <div className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.risk}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No risk level data.
                  </p>
                )}
              </div>

              {/* Potability score histogram */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-indigo-900">
                    Potability score
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    Histogram
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Potability scores across all field samples.
                </p>
                {a.confVals.length > 0 ? (
                  <>
                    <Plot
                      data={[
                        {
                          x: a.confVals,
                          type: "histogram",
                          nbinsx: 20,
                          marker: {
                            color: "#6366f1",
                            line: { color: "#4338ca", width: 1 },
                          },
                          hovertemplate:
                            "Potability: %{x:.2f}<br>Count: %{y}<extra></extra>",
                        },
                      ]}
                      layout={lay({
                        height: 260,
                        xaxis: {
                          title: "Potability",
                          range: [0, 1],
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          title: "Frequency",
                          rangemode: "tozero",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        showlegend: false,
                      })}
                      config={plotCfg}
                      useResizeHandler
                      style={{ width: "100%", height: "260px" }}
                    />
                    <div className="mt-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs">
                      <span className="text-[10px] uppercase tracking-[0.22em] text-indigo-600">
                        Avg potability:{" "}
                      </span>
                      <span className="font-semibold text-indigo-700">
                        {pct(a.avgConf)}
                      </span>
                      <span className="ml-3 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                        Samples:{" "}
                      </span>
                      <span className="font-semibold text-slate-700">
                        {a.confVals.length}
                      </span>
                    </div>
                    <div className="mt-2 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs text-indigo-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.fieldConfidence}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No potability data.
                  </p>
                )}
              </div>
            </div>
          </article>

          {/* ══════════════════════════════════════════════════════════════
              Section: Container Intelligence
              ══════════════════════════════════════════════════════════ */}
          {(a.csTotal > 0 || containerTableName) && (
            <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.35em] text-amber-700">
                Container intelligence
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Classification results and scan quality from{" "}
                {containerTableName || "container_scans"}.
              </p>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                {/* Predicted class breakdown */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-amber-900">
                      Predicted class breakdown
                    </p>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                      Distribution
                    </span>
                  </div>
                  <p className="mb-3 text-[11px] text-slate-500">
                    Predicted container classifications.
                  </p>
                  {a.classTop.length > 0 ? (
                    <>
                      <Plot
                        data={[
                          {
                            y: a.classTop.map(([k]) => k),
                            x: a.classTop.map(([, v]) => v),
                            type: "bar",
                            orientation: "h",
                            marker: { color: "#d97706" },
                            text: a.classTop.map(([, v]) => String(v)),
                            textposition: "outside",
                            hovertemplate:
                              "%{y}<br>Count: %{x}<extra></extra>",
                          },
                        ]}
                        layout={lay({
                          height: Math.max(220, a.classTop.length * 40),
                          margin: { l: 120 },
                          xaxis: {
                            title: "Count",
                            rangemode: "tozero",
                            gridcolor: "#e2e8f0",
                            tickfont: { size: 10, color: "#475569" },
                          },
                          yaxis: {
                            tickfont: { size: 10, color: "#475569" },
                            automargin: true,
                          },
                          showlegend: false,
                        })}
                        config={plotCfg}
                        useResizeHandler
                        style={{
                          width: "100%",
                          height: `${Math.max(220, a.classTop.length * 40)}px`,
                        }}
                      />
                      <div className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">
                        <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                        <p className="mt-1 leading-relaxed">{cardInsights.classBreakdown}</p>
                      </div>
                    </>
                  ) : (
                    <p className="py-8 text-center text-sm text-slate-400">
                      No classification data.
                    </p>
                  )}
                </div>

                {/* Scan validity & confidence */}
                <div className="space-y-5">
                  <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-amber-900">
                        Scan validity
                      </p>
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                        Ratio
                      </span>
                    </div>
                    <p className="mb-3 text-[11px] text-slate-500">
                      Valid vs rejected scans.
                    </p>
                    {a.csTotal > 0 ? (
                      <>
                        <Plot
                          data={[
                            {
                              labels: ["Valid", "Invalid"],
                              values: [a.csValid, a.csInvalid],
                              type: "pie",
                              hole: 0.45,
                              marker: { colors: ["#10b981", "#ef4444"] },
                              textinfo: "percent+label",
                              hovertemplate:
                                "%{label}<br>Count: %{value}<br>%{percent}<extra></extra>",
                            },
                          ]}
                          layout={pieLay(220)}
                          config={plotCfg}
                          useResizeHandler
                          style={{ width: "100%", height: "220px" }}
                        />
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-600">
                              Valid
                            </p>
                            <p className="mt-1 font-semibold text-emerald-700">
                              {a.csValid}
                            </p>
                          </div>
                          <div className="rounded-lg border border-rose-200 bg-white px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-rose-600">
                              Invalid
                            </p>
                            <p className="mt-1 font-semibold text-rose-700">
                              {a.csInvalid}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">
                          <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                          <p className="mt-1 leading-relaxed">{cardInsights.scanValidity}</p>
                        </div>
                      </>
                    ) : (
                      <p className="py-4 text-center text-sm text-slate-400">
                        No scan data.
                      </p>
                    )}
                  </div>

                  {a.csConfVals.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-900">
                          Container confidence
                        </p>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                          Histogram
                        </span>
                      </div>
                      <Plot
                        data={[
                          {
                            x: a.csConfVals,
                            type: "histogram",
                            nbinsx: 20,
                            marker: {
                              color: "#d97706",
                              line: { color: "#b45309", width: 1 },
                            },
                            hovertemplate:
                              "Confidence: %{x:.3f}<br>Count: %{y}<extra></extra>",
                          },
                        ]}
                        layout={lay({
                          height: 220,
                          xaxis: {
                            title: "Confidence",
                            range: [0, 1],
                            tickfont: { size: 10, color: "#475569" },
                          },
                          yaxis: {
                            title: "Frequency",
                            rangemode: "tozero",
                            gridcolor: "#e2e8f0",
                            tickfont: { size: 10, color: "#475569" },
                          },
                          showlegend: false,
                        })}
                        config={plotCfg}
                        useResizeHandler
                        style={{ width: "100%", height: "220px" }}
                      />
                      <div className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">
                        <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                        <p className="mt-1 leading-relaxed">{cardInsights.containerConfidence}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          )}

          {/* ══════════════════════════════════════════════════════════════
              Section: Microbial Risk (conditional)
              ══════════════════════════════════════════════════════════ */}
          {a.hasMicro && (
            <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.35em] text-rose-700">
                Microbial risk analysis
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Contamination risk distribution from field sample microbial
                assessments.
              </p>
              <div className="mt-5 max-w-lg">
                <Plot
                  data={[
                    {
                      labels: Object.keys(a.microCounts).map(
                        (k) => k.charAt(0).toUpperCase() + k.slice(1),
                      ),
                      values: Object.values(a.microCounts),
                      type: "pie",
                      hole: 0.45,
                      marker: {
                        colors: Object.keys(a.microCounts).map((k) => {
                          if (k === "low") return "#10b981";
                          if (k === "medium") return "#f59e0b";
                          if (k === "high") return "#ef4444";
                          return "#94a3b8";
                        }),
                      },
                      textinfo: "percent+label",
                      hovertemplate:
                        "%{label}<br>Count: %{value}<br>%{percent}<extra></extra>",
                    },
                  ]}
                  layout={pieLay(280)}
                  config={plotCfg}
                  useResizeHandler
                  style={{ width: "100%", height: "280px" }}
                />
                <div className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                  <p className="mt-1 leading-relaxed">{cardInsights.microbial}</p>
                </div>
              </div>
            </article>
          )}

          {/* ══════════════════════════════════════════════════════════════
              Section: Community Forum
              ══════════════════════════════════════════════════════════ */}
          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-700">
              Community forum
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Thread &amp; post activity, category popularity, and moderation
              signals.
            </p>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              {/* Forum activity trend */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-emerald-900">
                    Forum activity trend
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    30 days
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Threads and posts created per day.
                </p>
                {a.ftBuckets.some((b) => b.count > 0) ||
                a.fpBuckets.some((b) => b.count > 0) ? (
                  <Plot
                    data={[
                      {
                        x: a.ftBuckets.map((b) => dateLbl(b.date)),
                        y: a.ftBuckets.map((b) => b.count),
                        type: "bar",
                        name: "Threads",
                        marker: { color: "#059669" },
                        hovertemplate:
                          "%{x}<br>Threads: %{y}<extra></extra>",
                      },
                      {
                        x: a.fpBuckets.map((b) => dateLbl(b.date)),
                        y: a.fpBuckets.map((b) => b.count),
                        type: "bar",
                        name: "Posts",
                        marker: { color: "#6ee7b7" },
                        hovertemplate:
                          "%{x}<br>Posts: %{y}<extra></extra>",
                      },
                    ]}
                    layout={lay({
                      height: 270,
                      barmode: "stack",
                      xaxis: {
                        title: "Day",
                        gridcolor: "#e2e8f0",
                        tickfont: { size: 10, color: "#475569" },
                      },
                      yaxis: {
                        title: "Count",
                        rangemode: "tozero",
                        gridcolor: "#e2e8f0",
                        tickfont: { size: 10, color: "#475569" },
                      },
                      legend: {
                        orientation: "h",
                        y: 1.14,
                        x: 0,
                        font: { size: 10, color: "#475569" },
                      },
                    })}
                    config={plotCfg}
                    useResizeHandler
                    style={{ width: "100%", height: "270px" }}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No forum activity in the last 30 days.
                  </p>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      Threads
                    </p>
                    <p className="mt-1 font-semibold text-slate-700">
                      {a.ftTotal}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      Posts
                    </p>
                    <p className="mt-1 font-semibold text-slate-700">
                      {a.fpTotal}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      Avg replies/thread
                    </p>
                    <p className="mt-1 font-semibold text-slate-700">
                      {a.repliesPerThread.toFixed(1)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs text-emerald-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                  <p className="mt-1 leading-relaxed">{cardInsights.forumActivity}</p>
                </div>
              </div>

              {/* Category popularity */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-emerald-900">
                    Category popularity
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    Thread tags
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Thread distribution by forum category.
                </p>
                {a.catTop.length > 0 ? (
                  <Plot
                    data={[
                      {
                        y: a.catTop.map(([k]) => k),
                        x: a.catTop.map(([, v]) => v),
                        type: "bar",
                        orientation: "h",
                        marker: { color: "#059669" },
                        text: a.catTop.map(([, v]) => String(v)),
                        textposition: "outside",
                        hovertemplate:
                          "%{y}<br>Threads: %{x}<extra></extra>",
                      },
                    ]}
                    layout={lay({
                      height: Math.max(200, a.catTop.length * 40),
                      margin: { l: 100 },
                      xaxis: {
                        title: "Threads",
                        rangemode: "tozero",
                        gridcolor: "#e2e8f0",
                        tickfont: { size: 10, color: "#475569" },
                      },
                      yaxis: {
                        tickfont: { size: 10, color: "#475569" },
                        automargin: true,
                      },
                      showlegend: false,
                    })}
                    config={plotCfg}
                    useResizeHandler
                    style={{
                      width: "100%",
                      height: `${Math.max(200, a.catTop.length * 40)}px`,
                    }}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No category data.
                  </p>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                      Locked threads
                    </p>
                    <p className="mt-1 font-semibold text-slate-700">
                      {a.ftLocked}
                    </p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-rose-600">
                      Deleted posts
                    </p>
                    <p className="mt-1 font-semibold text-rose-700">
                      {a.fpDeleted}
                    </p>
                  </div>
                </div>
                <div className="mt-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs text-emerald-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                  <p className="mt-1 leading-relaxed">{cardInsights.category}</p>
                </div>
              </div>
            </div>
          </article>

          {/* ══════════════════════════════════════════════════════════════
              Section: Platform Engagement
              ══════════════════════════════════════════════════════════ */}
          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-600">
              Platform engagement
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Cross-system contributor activity and sample source distribution.
            </p>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              {/* Top contributors */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Top contributors
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    Top 10
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Most active users by combined actions (samples + scans +
                  forum).
                </p>
                {a.topContribs.length > 0 ? (
                  <>
                    <Plot
                      data={[
                        {
                          y: a.topContribs.map((c) => c.label),
                          x: a.topContribs.map((c) => c.count),
                          type: "bar",
                          orientation: "h",
                          marker: { color: "#0284c7" },
                          text: a.topContribs.map((c) => String(c.count)),
                          textposition: "outside",
                          hovertemplate:
                            "User: %{y}<br>Actions: %{x}<extra></extra>",
                        },
                      ]}
                      layout={lay({
                        height: Math.max(220, a.topContribs.length * 32),
                        margin: { l: 90 },
                        xaxis: {
                          title: "Total actions",
                          rangemode: "tozero",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          tickfont: { size: 10, color: "#475569" },
                          autorange: "reversed",
                        },
                        showlegend: false,
                      })}
                      config={plotCfg}
                      useResizeHandler
                      style={{
                        width: "100%",
                        height: `${Math.max(220, a.topContribs.length * 32)}px`,
                      }}
                    />
                    <div className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.contributors}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No contributor data.
                  </p>
                )}
              </div>

              {/* Source distribution */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Sample source distribution
                  </p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    Field samples
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Origin/source labels from field samples.
                </p>
                {a.sourceTop.length > 0 ? (
                  <>
                    <Plot
                      data={[
                        {
                          y: a.sourceTop.map(([k]) => k),
                          x: a.sourceTop.map(([, v]) => v),
                          type: "bar",
                          orientation: "h",
                          marker: { color: "#7c3aed" },
                          text: a.sourceTop.map(([, v]) => String(v)),
                          textposition: "outside",
                          hovertemplate:
                            "%{y}<br>Samples: %{x}<extra></extra>",
                        },
                      ]}
                      layout={lay({
                        height: Math.max(220, a.sourceTop.length * 36),
                        margin: { l: 100 },
                        xaxis: {
                          title: "Count",
                          rangemode: "tozero",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          tickfont: { size: 10, color: "#475569" },
                          automargin: true,
                        },
                        showlegend: false,
                      })}
                      config={plotCfg}
                      useResizeHandler
                      style={{
                        width: "100%",
                        height: `${Math.max(220, a.sourceTop.length * 36)}px`,
                      }}
                    />
                    <div className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                      <p className="mt-1 leading-relaxed">{cardInsights.source}</p>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No source data available.
                  </p>
                )}
              </div>
            </div>
          </article>

          {/* ══════════════════════════════════════════════════════════════
              Section: Organization Distribution (conditional)
              ══════════════════════════════════════════════════════════ */}
          {a.orgTop.length > 1 && (
            <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.35em] text-sky-700">
                Organization distribution
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Users grouped by organization affiliation.
              </p>
              <div className="mt-5 max-w-2xl">
                <Plot
                  data={[
                    {
                      y: a.orgTop.map(([k]) => k),
                      x: a.orgTop.map(([, v]) => v),
                      type: "bar",
                      orientation: "h",
                      marker: { color: "#0284c7" },
                      text: a.orgTop.map(([, v]) => String(v)),
                      textposition: "outside",
                      hovertemplate:
                        "%{y}<br>Users: %{x}<extra></extra>",
                    },
                  ]}
                  layout={lay({
                    height: Math.max(200, a.orgTop.length * 36),
                    margin: { l: 120 },
                    xaxis: {
                      title: "Users",
                      rangemode: "tozero",
                      gridcolor: "#e2e8f0",
                      tickfont: { size: 10, color: "#475569" },
                    },
                    yaxis: {
                      tickfont: { size: 10, color: "#475569" },
                      automargin: true,
                    },
                    showlegend: false,
                  })}
                  config={plotCfg}
                  useResizeHandler
                  style={{
                    width: "100%",
                    height: `${Math.max(200, a.orgTop.length * 36)}px`,
                  }}
                />
                <div className="mt-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs text-sky-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Trend Insight</p>
                  <p className="mt-1 leading-relaxed">{cardInsights.organization}</p>
                </div>
              </div>
            </article>
          )}

          {/* ══════════════════════════════════════════════════════════════
              Data Summary Footer
              ══════════════════════════════════════════════════════════ */}
          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">
              Data summary
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Profiles",
                  value: a.totalUsers,
                  table: PROFILES_TABLE,
                },
                {
                  label: "Field samples",
                  value: a.fsTotal,
                  table: FIELD_SAMPLES_TABLE,
                },
                {
                  label: "Container scans",
                  value: a.csTotal,
                  table: containerTableName || "\u2014",
                },
                {
                  label: "Forum threads",
                  value: a.ftTotal,
                  table: "forum_threads",
                },
                {
                  label: "Forum posts",
                  value: a.fpTotal,
                  table: "forum_posts",
                },
                {
                  label: "Thread likes",
                  value: likeCounts.thread,
                  table: "forum_thread_likes",
                },
                {
                  label: "Post likes",
                  value: likeCounts.post,
                  table: "forum_post_likes",
                },
                {
                  label: "Categories",
                  value: forumCategories.length,
                  table: "forum_categories",
                },
              ].map((r) => (
                <div
                  key={r.label}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    {r.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-700">
                    {r.value}
                  </p>
                  <p className="text-[10px] text-slate-400">{r.table}</p>
                </div>
              ))}
            </div>
          </article>
        </Suspense>
      )}
    </section>
  );
}
