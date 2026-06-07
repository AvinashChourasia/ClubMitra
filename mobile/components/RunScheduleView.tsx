// RunScheduleView: a list (week navigator) + month-calendar view of runs. Shared
// by the personal schedule screen and the club's Run-schedule tab so they look
// and behave identically. Caller supplies the runs and an open-run handler.

import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, styles } from "../lib/theme";
import { formatRunDate, formatTimeOnly, isPast } from "../lib/format";
import { Calendar, toDateStr } from "./Calendar";

const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Minimal run shape this view needs. checked_in / chapter_name are optional
// (a club's runs don't carry them; the personal schedule does).
export type ScheduleRun = {
  id: string;
  title: string;
  scheduled_at: string;
  has_time: boolean;
  chapter_name?: string;
  checked_in?: boolean;
};

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function RunRow({ run, showChapter, onPress }: { run: ScheduleRun; showChapter: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <View style={{ width: 60 }}>
        <Text style={{ color: isPast(run.scheduled_at) ? colors.muted : colors.primary, fontWeight: "700", fontSize: 13 }}>
          {run.has_time ? formatTimeOnly(run.scheduled_at) : "TBD"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{run.title}</Text>
        {showChapter && run.chapter_name ? <Text style={{ color: colors.muted, fontSize: 12 }}>{run.chapter_name}</Text> : null}
      </View>
      {run.checked_in && (
        <View style={{ backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✓ In</Text>
        </View>
      )}
    </Pressable>
  );
}

export function RunScheduleView({
  runs,
  onOpenRun,
  showChapter = true,
}: {
  runs: ScheduleRun[];
  onOpenRun: (id: string) => void;
  showChapter?: boolean;
}) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [selected, setSelected] = useState(toDateStr(new Date()));

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleRun[]>();
    runs.forEach((r) => {
      const key = toDateStr(new Date(r.scheduled_at));
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    });
    map.forEach((list) => list.sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at)));
    return map;
  }, [runs]);

  const marked = useMemo(() => new Set(byDate.keys()), [byDate]);
  const done = useMemo(() => {
    const s = new Set<string>();
    runs.forEach((r) => r.checked_in && s.add(toDateStr(new Date(r.scheduled_at))));
    return s;
  }, [runs]);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <View style={{ gap: 14 }}>
      {/* View toggle */}
      <View style={{ flexDirection: "row", backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 }}>
        {(["list", "calendar"] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setView(v)}
            style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center", backgroundColor: view === v ? colors.primary : "transparent" }}
          >
            <Text style={{ color: view === v ? "#fff" : colors.muted, fontWeight: "700", textTransform: "capitalize" }}>{v}</Text>
          </Pressable>
        ))}
      </View>

      {view === "list" ? (
        <>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Pressable onPress={() => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() - 7); return n; })} hitSlop={10}>
              <Text style={{ color: colors.accent, fontSize: 20, fontWeight: "700" }}>‹</Text>
            </Pressable>
            <Text style={{ fontWeight: "800", color: colors.text }}>
              {formatRunDate(weekStart.toISOString())} – {formatRunDate(weekDays[6].toISOString())}
            </Text>
            <Pressable onPress={() => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() + 7); return n; })} hitSlop={10}>
              <Text style={{ color: colors.accent, fontSize: 20, fontWeight: "700" }}>›</Text>
            </Pressable>
          </View>

          {weekDays.map((d) => {
            const key = toDateStr(d);
            const dayRuns = byDate.get(key) ?? [];
            const isToday = key === toDateStr(new Date());
            return (
              <View key={key} style={styles.card}>
                <Text style={{ fontWeight: "800", color: isToday ? colors.primary : colors.text, marginBottom: dayRuns.length ? 4 : 0 }}>
                  {DAYNAMES[d.getDay()]} {d.getDate()} {isToday ? "· Today" : ""}
                </Text>
                {dayRuns.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Free — no runs.</Text>
                ) : (
                  dayRuns.map((r) => <RunRow key={r.id} run={r} showChapter={showChapter} onPress={() => onOpenRun(r.id)} />)
                )}
              </View>
            );
          })}
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Calendar selected={selected} onSelect={setSelected} marked={marked} done={done} />
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 10 }}>
              <Legend color={colors.accent} label="Scheduled" />
              <Legend color={colors.success} label="Checked in" />
            </View>
          </View>
          <View style={styles.card}>
            <Text style={{ fontWeight: "800", color: colors.text, marginBottom: 6 }}>{formatRunDate(selected + "T00:00:00")}</Text>
            {(byDate.get(selected) ?? []).length === 0 ? (
              <Text style={{ color: colors.muted }}>No runs on this day.</Text>
            ) : (
              byDate.get(selected)!.map((r) => <RunRow key={r.id} run={r} showChapter={showChapter} onPress={() => onOpenRun(r.id)} />)
            )}
          </View>
        </>
      )}
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
