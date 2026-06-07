// Calendar: a month grid for picking a date and for showing which days have
// runs. Used by the schedule-create form (date picker) and the profile schedule
// (month view). Self-contained — manages the visible month internally.

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../lib/theme";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Local YYYY-MM-DD for a date (avoids UTC shifting from toISOString).
export function toDateStr(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Props = {
  selected?: string | null; // YYYY-MM-DD
  onSelect?: (date: string) => void;
  marked?: Set<string>; // dates with a dot (a run scheduled)
  done?: Set<string>; // dates the user checked into — dot shown green
  minDate?: Date | null; // dates before this are disabled
};

export function Calendar({ selected, onSelect, marked, done, minDate }: Props) {
  const initial = selected ? new Date(selected + "T00:00:00") : new Date();
  const [view, setView] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = toDateStr(new Date());

  // Build the grid cells: leading blanks then the days.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const minStr = minDate ? toDateStr(minDate) : null;

  return (
    <View>
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Pressable onPress={() => setView(new Date(year, month - 1, 1))} hitSlop={10}>
          <Text style={{ color: colors.accent, fontSize: 22, fontWeight: "700" }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text }}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable onPress={() => setView(new Date(year, month + 1, 1))} hitSlop={10}>
          <Text style={{ color: colors.accent, fontSize: 22, fontWeight: "700" }}>›</Text>
        </Pressable>
      </View>

      {/* Weekday labels */}
      <View style={{ flexDirection: "row" }}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={{ flex: 1, textAlign: "center", color: colors.muted, fontSize: 11, fontWeight: "700" }}>
            {w}
          </Text>
        ))}
      </View>

      {/* Day grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((d, i) => {
          if (d === null) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
          const dateStr = toDateStr(new Date(year, month, d));
          const isSelected = selected === dateStr;
          const isToday = todayStr === dateStr;
          const isMarked = marked?.has(dateStr);
          const isDone = done?.has(dateStr);
          const disabled = minStr ? dateStr < minStr : false;
          return (
            <Pressable
              key={dateStr}
              disabled={disabled || !onSelect}
              onPress={() => onSelect?.(dateStr)}
              style={{ width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isSelected ? colors.primary : "transparent",
                  borderWidth: isToday && !isSelected ? 1 : 0,
                  borderColor: colors.primary,
                  opacity: disabled ? 0.3 : 1,
                }}
              >
                <Text style={{ color: isSelected ? "#fff" : colors.text, fontWeight: isToday ? "800" : "500" }}>{d}</Text>
              </View>
              {isMarked && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 5,
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: isSelected ? "#fff" : isDone ? colors.success : colors.accent,
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
