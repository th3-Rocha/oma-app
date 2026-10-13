import * as Clipboard from "expo-clipboard";
import { useCallback, useState } from "react";
import { TextInput, View } from "react-native";

import { Button, Card, Chip, Row, Screen, T, attempt, toast, type IconName } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { fonts, themed, useColors } from "@/lib/theme";

const useStyles = themed((c) => ({
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: c.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    backgroundColor: c.bg,
  },
  pad: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  key: { flexBasis: "22%", flexGrow: 1 },
}));

const KEYS: { key: string; icon?: IconName; label?: string }[] = [
  { key: "Escape", label: "esc" },
  { key: "Up", icon: "arrow-up" },
  { key: "Tab", label: "tab" },
  { key: "BackSpace", icon: "delete" },
  { key: "Left", icon: "arrow-left" },
  { key: "Down", icon: "arrow-down" },
  { key: "Right", icon: "arrow-right" },
  { key: "Return", icon: "corner-down-left" },
  { key: "space", label: "espaço" },
  { key: "F5", label: "F5" },
  { key: "F11", label: "F11" },
  { key: "Page_Down", label: "pg↓" },
];

const MODS = ["ctrl", "alt", "shift", "logo"] as const;

export default function Send() {
  const s = useStyles();
  const c = useColors();
  const { api } = useConnection();

  const [text, setText] = useState("");
  const [pcClipboard, setPcClipboard] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [mods, setMods] = useState<string[]>([]);
  const [combo, setCombo] = useState("");

  const key = useCallback(
    (name: string) => {
      void attempt(() => api("/api/input/key", { body: { key: name, mods } }));
      setMods([]);
    },
    [api, mods],
  );

  return (
    <Screen title="Enviar" subtitle="do celular para o PC">
      <Card title="Texto">
        <TextInput
          style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
          value={text}
          onChangeText={setText}
          placeholder="Digite ou cole algo…"
          placeholderTextColor={c.muted}
          multiline
        />
        <Row>
          <Button style={{ flex: 1 }} icon="clipboard" label="Colar" onPress={() => void Clipboard.getStringAsync().then(setText)} />
          <Button style={{ flex: 1 }} icon="x" label="Limpar" disabled={!text} onPress={() => setText("")} />
        </Row>
        <Row>
          <Button
            style={{ flex: 1 }}
            icon="copy"
            label="Pro clipboard"
            variant="primary"
            disabled={!text}
            onPress={() => void attempt(() => api("/api/clipboard", { body: { text } }), "Copiado no PC")}
          />
          <Button
            style={{ flex: 1 }}
            icon="type"
            label="Digitar"
            disabled={!text}
            onPress={() => void attempt(() => api("/api/input/type", { body: { text }, timeoutMs: 16000 }), "Digitado na janela ativa")}
          />
        </Row>
      </Card>

      <Card title="Clipboard do PC">
        {pcClipboard !== null ? (
          <T lines={8} style={{ fontSize: 12 }}>
            {pcClipboard || "(vazio)"}
          </T>
        ) : (
          <T muted>Busque o que está copiado no PC e traga pro celular.</T>
        )}
        <Row>
          <Button
            style={{ flex: 1 }}
            icon="download"
            label="Buscar"
            onPress={() => void attempt(async () => setPcClipboard((await api<{ text: string }>("/api/clipboard")).text))}
          />
          <Button
            style={{ flex: 1 }}
            icon="copy"
            label="Copiar aqui"
            disabled={!pcClipboard}
            onPress={() => void Clipboard.setStringAsync(pcClipboard ?? "").then(() => toast("Copiado no celular"))}
          />
        </Row>
      </Card>

      <Card title="Teclas">
        <Row>
          {MODS.map((mod) => (
            <Chip
              key={mod}
              label={mod === "logo" ? "super" : mod}
              active={mods.includes(mod)}
              onPress={() => setMods((previous) => (previous.includes(mod) ? previous.filter((item) => item !== mod) : [...previous, mod]))}
            />
          ))}
        </Row>
        <View style={s.pad}>
          {KEYS.map((item) => (
            <Button key={item.key} style={s.key} icon={item.icon} label={item.label} onPress={() => key(item.key)} />
          ))}
        </View>
        <Row>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={combo}
            onChangeText={(value) => setCombo(value.slice(-1))}
            placeholder="letra/número (com os modificadores acima)"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={2}
          />
          <Button
            label="Enviar"
            disabled={!/^[a-zA-Z0-9]$/.test(combo)}
            onPress={() => {
              key(combo);
              setCombo("");
            }}
          />
        </Row>
      </Card>

      <Card title="Abrir link no PC">
        <Row>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={link}
            onChangeText={setLink}
            placeholder="https://…"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Button
            label="Abrir"
            icon="external-link"
            disabled={!link.trim()}
            onPress={() => {
              const target = /^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`;
              void attempt(() => api("/api/open", { body: { text: target } }), "Aberto no PC");
            }}
          />
        </Row>
      </Card>

      <Card title="Notificação">
        <Row>
          <TextInput style={[s.input, { flex: 1 }]} value={title} onChangeText={setTitle} placeholder="Mensagem" placeholderTextColor={c.muted} />
          <Button
            label="Enviar"
            icon="bell"
            disabled={!title.trim()}
            onPress={() => void attempt(() => api("/api/notify", { body: { title: title.trim(), body: "enviado do celular" } }), "Notificação enviada").then(() => setTitle(""))}
          />
        </Row>
      </Card>
    </Screen>
  );
}
