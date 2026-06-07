// ClubFeeFields: the approval + membership-fee + subscription config shared by
// the create-club and edit-club forms.

import { Switch, Text, TextInput, View } from "react-native";
import { ChipSelect } from "./ChipSelect";
import { colors, styles } from "../lib/theme";
import type { ClubSettings } from "../lib/clubs";

export type FeeState = {
  requiresApproval: boolean;
  feeEnabled: boolean;
  amount: string;
  period: "monthly" | "annual";
  renewalDays: string;
};

export const defaultFeeState: FeeState = {
  requiresApproval: true,
  feeEnabled: false,
  amount: "",
  period: "monthly",
  renewalDays: "5",
};

// feeSettings turns the form state into the API's ClubSettings.
export function feeSettings(s: FeeState): ClubSettings {
  return {
    requires_approval: s.requiresApproval,
    membership_fee_enabled: s.feeEnabled,
    membership_fee_amount: s.feeEnabled && s.amount ? Number(s.amount) : undefined,
    membership_period: s.feeEnabled ? s.period : undefined,
    renewal_window_days: s.renewalDays ? Number(s.renewalDays) : undefined,
  };
}

function ToggleRow({ label, hint, value, onValueChange }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export function ClubFeeFields({ value, onChange }: { value: FeeState; onChange: (v: FeeState) => void }) {
  const set = (patch: Partial<FeeState>) => onChange({ ...value, ...patch });
  return (
    <>
      <ToggleRow
        label="Require admin approval"
        hint="New members wait for an admin to approve them."
        value={value.requiresApproval}
        onValueChange={(v) => set({ requiresApproval: v })}
      />
      <ToggleRow
        label="Charge a membership fee"
        value={value.feeEnabled}
        onValueChange={(v) => set({ feeEnabled: v })}
      />
      {value.feeEnabled && (
        <>
          <Text style={styles.fieldLabel}>Fee amount (₹)</Text>
          <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="e.g. 500" placeholderTextColor={colors.muted} value={value.amount} onChangeText={(t) => set({ amount: t })} />
          <Text style={styles.fieldLabel}>Billing period</Text>
          <ChipSelect
            options={[{ key: "monthly", label: "Monthly" }, { key: "annual", label: "Annual" }]}
            value={value.period}
            onChange={(k) => set({ period: (k as "monthly" | "annual") ?? "monthly" })}
          />
          <Text style={styles.fieldLabel}>Renewal window (days before expiry)</Text>
          <TextInput style={styles.input} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.muted} value={value.renewalDays} onChangeText={(t) => set({ renewalDays: t })} />
        </>
      )}
    </>
  );
}
