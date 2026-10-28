import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

// Tokens de docs/UX_UI.md (mismos valores que apps/web/app/globals.css). Controles ≥ 48 px (campo), texto en español,
// estado con texto además de color, propiedades de accesibilidad nativas.
export const T = {
  forest: '#173d35', operation: '#2b6650', ivory: '#f5f2e9', text: '#172b29', text2: '#52615d', surface: '#ffffff', border: '#7c8982', subtle: '#dce3dd',
  valid: '#28784b', validBg: '#edf5ef', review: '#895a15', reviewBg: '#fff4df', blocked: '#a33c38', blockedBg: '#fbefee', process: '#285d88', processBg: '#eef4fa',
};
type Tone = 'valid' | 'review' | 'blocked' | 'process' | 'neutral';
const TONE: Record<Tone, [string, string]> = { valid: [T.valid, T.validBg], review: [T.review, T.reviewBg], blocked: [T.blocked, T.blockedBg], process: [T.process, T.processBg], neutral: [T.text2, '#edf1ec'] };

export function Button({ label, onPress, kind = 'primary', disabled, hint }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; disabled?: boolean; hint?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, kind === 'secondary' && s.btn2, disabled && s.btnOff, pressed && { opacity: 0.85 }]}>
      <Text style={[s.btnText, kind === 'secondary' && { color: T.forest }]}>{label}</Text>
    </Pressable>
  );
}
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Text style={[s.badge, { color: TONE[tone][0], backgroundColor: TONE[tone][1] }]}>{children}</Text>;
}
export function Notice({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return (
    <View accessibilityRole="alert" style={[s.notice, { borderLeftColor: TONE[tone][0], backgroundColor: TONE[tone][1] }]}>
      {title ? <Text style={[s.h3, { color: TONE[tone][0] }]}>{title}</Text> : null}
      <Text style={s.p}>{children}</Text>
    </View>
  );
}
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return <View style={s.card}>{title ? <Text accessibilityRole="header" style={s.h2}>{title}</Text> : null}{children}</View>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={T.text2} style={[s.input, props.multiline && { minHeight: 96, textAlignVertical: 'top' }]} {...props} />
    </View>
  );
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.ivory },
  body: { padding: 16, paddingBottom: 112, width: '100%', maxWidth: 720, alignSelf: 'center' }, // columna legible en pantallas anchas // margen para la barra de navegación de Android (pantalla de borde a borde)
  header: { backgroundColor: T.forest, paddingTop: 44, paddingBottom: 12, paddingHorizontal: 16 },
  brand: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  sub: { color: '#dce3dd', fontSize: 14 },
  previewBanner: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: T.reviewBg, color: T.review, fontSize: 13, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }, // solo vista previa web
  h1: { fontSize: 24, fontWeight: '700', color: T.text, marginBottom: 12 },
  h2: { fontSize: 19, fontWeight: '700', color: T.text, marginBottom: 8 },
  h3: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  p: { fontSize: 16, color: T.text, lineHeight: 23 },
  muted: { fontSize: 15, color: T.text2, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600', color: T.text, marginBottom: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: T.border, borderRadius: 6, paddingHorizontal: 12, fontSize: 17, color: T.text, backgroundColor: T.surface },
  btn: { minHeight: 48, borderRadius: 6, backgroundColor: T.forest, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, marginVertical: 6 }, // aire si la etiqueta ocupa dos líneas
  btn2: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.forest },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, fontSize: 14, fontWeight: '600', overflow: 'hidden', marginVertical: 2 },
  notice: { borderLeftWidth: 4, padding: 12, borderRadius: 6, marginBottom: 12 },
  card: { backgroundColor: T.surface, borderRadius: 10, borderWidth: 1, borderColor: T.subtle, padding: 16, marginBottom: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: T.subtle, backgroundColor: T.surface },
  tab: { flex: 1, minWidth: 0, minHeight: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
  tabText: { fontSize: 14, color: T.text2, fontWeight: '600' },
});
