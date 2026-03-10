import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export const CHAT_TABS = { WATER: "water_quality", DATA: "my_data" };

export const WATER_PARAMETERS = [
  { name: "pH", range: "6.5 – 8.5", unit: "", desc: "Acidity / alkalinity" },
  { name: "Hardness", range: "47 – 323", unit: "mg/L", desc: "Calcium & magnesium" },
  { name: "Solids", range: "320 – 61 227", unit: "ppm", desc: "Total dissolved solids" },
  { name: "Chloramines", range: "1.4 – 13.1", unit: "ppm", desc: "Disinfection level" },
  { name: "Sulfate", range: "129 – 481", unit: "mg/L", desc: "Mineral content" },
  { name: "Conductivity", range: "181 – 753", unit: "μS/cm", desc: "Ionic concentration" },
  { name: "Organic carbon", range: "2.2 – 28.3", unit: "ppm", desc: "Organic matter" },
  { name: "Trihalomethanes", range: "0.7 – 124", unit: "μg/L", desc: "Disinfection byproducts" },
  { name: "Turbidity", range: "1.5 – 6.7", unit: "NTU", desc: "Water clarity" },
];

const CONTAINER_SCANS_TABLE_CANDIDATES = [
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE,
  import.meta.env.VITE_PUBLIC_CONTAINER_SAMPLES_TABLE,
  "container_scans",
  "container_samples",
].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);

const MISSING_RELATION_ERROR_CODE = "42P01";
const MISSING_SCHEMA_ERROR_CODE = "3F000";

const isMissingRelationError = (error) =>
  error?.code === MISSING_RELATION_ERROR_CODE || error?.code === MISSING_SCHEMA_ERROR_CODE;

const countRowsForUser = async (table, userId) => {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  return { count: count || 0, error };
};

const resolveContainerScansTableForUser = async (userId) => {
  for (const table of CONTAINER_SCANS_TABLE_CANDIDATES) {
    const result = await countRowsForUser(table, userId);
    if (!result.error) {
      return result.count;
    }

    if (isMissingRelationError(result.error)) {
      continue;
    }
  }

  return 0;
};

export async function fetchCopilotUserSnapshot(userId) {
  const empty = { userStats: { scans: 0, predictions: 0 }, lastSample: null };
  if (!userId || !supabase || !isSupabaseConfigured) return empty;

  try {
    const [{ count: fieldCount }, containerCount, { data: sampleData }] = await Promise.all([
      supabase
        .from("field_samples")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      resolveContainerScansTableForUser(userId),
      supabase
        .from("field_samples")
        .select("id, sample_label, ph, turbidity, risk_level, prediction_is_potable, prediction_probability, hardness, chloramines, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      userStats: {
        scans: (fieldCount || 0) + (containerCount || 0),
        predictions: fieldCount || 0,
      },
      lastSample: sampleData || null,
    };
  } catch {
    return empty;
  }
}

export function buildCopilotChatAnalysis({ source, tab, displayName, userStats, lastSample }) {
  const stats = {
    scans: Number(userStats?.scans) || 0,
    predictions: Number(userStats?.predictions) || 0,
  };

  const commonLastSample = lastSample
    ? {
        risk_level: lastSample.risk_level,
        is_potable: lastSample.prediction_is_potable,
        recorded_at: lastSample.created_at,
      }
    : null;

  const context =
    tab === CHAT_TABS.WATER
      ? {
          focus: "water_quality",
          guidance:
            "Focus on water quality interpretation, filtration suggestions, risk-level explanation, and safe follow-up actions. The user's most recent sample data is provided — reference it directly when relevant.",
          water_parameters: WATER_PARAMETERS,
          ...(lastSample
            ? {
                last_sample: {
                  label: lastSample.sample_label || "last sample",
                  ph: lastSample.ph,
                  turbidity: lastSample.turbidity,
                  hardness: lastSample.hardness,
                  chloramines: lastSample.chloramines,
                  risk_level: lastSample.risk_level,
                  is_potable: lastSample.prediction_is_potable,
                  confidence: lastSample.prediction_probability,
                  recorded_at: lastSample.created_at,
                },
              }
            : {}),
        }
      : {
          focus: "my_data",
          guidance:
            "Focus on the user's activity and trends, summarize what their dashboard metrics imply, and suggest next steps based on personal data.",
          dashboard_metrics: stats,
          user_name: displayName || "User",
          ...(commonLastSample ? { last_sample: commonLastSample } : {}),
        };

  return {
    source,
    user_stats: stats,
    context,
  };
}