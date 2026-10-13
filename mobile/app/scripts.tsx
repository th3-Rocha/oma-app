import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Button, Card, Empty, HeaderButton, Loading, Row, Screen, T } from "@/components/ui";
import { ApiError, useConnection } from "@/lib/connection";
import { fonts, themed, useColors } from "@/lib/theme";
import type { ScriptList, ScriptResult } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const useStyles = themed((c) => ({
  output: { backgroundColor: c.bg, borderRadius: 6, borderWidth: 1, borderColor: c.border, padding: 10, maxHeight: 220 },
  outputText: { color: c.text, fontFamily: fonts.regular, fontSize: 11 },
}));

type Run = { running: boolean; result?: ScriptResult; error?: string };

export default function Scripts() {
  const s = useStyles();
  const c = useColors();
  const { api } = useConnection();
  const list = usePolling<ScriptList>("/api/scripts", 0);
  const [runs, setRuns] = useState<Record<string, Run>>({});

  const run = useCallback(
    async (id: string) => {
      setRuns((previous) => ({ ...previous, [id]: { running: true } }));
      try {
        const result = await api<ScriptResult>(`/api/scripts/${encodeURIComponent(id)}`, { method: "POST", timeoutMs: 35000 });
        setRuns((previous) => ({ ...previous, [id]: { running: false, result } }));
      } catch (error) {
        setRuns((previous) => ({ ...previous, [id]: { running: false, error: error instanceof ApiError ? error.message : "Falhou" } }));
      }
    },
    [api],
  );

  return (
    <Screen title="Scripts" subtitle={list.data?.dir} right={<HeaderButton icon="refresh-cw" label="Recarregar" onPress={() => void list.refresh()} />}>
      {!list.data ? <Loading /> : null}
      {list.data && list.data.scripts.length === 0 ? (
        <Card>
          <Empty icon="zap" text={`Nenhum script ainda. Coloque arquivos .sh em\n${list.data.dir}\ne eles aparecem aqui.`} />
        </Card>
      ) : null}
      {list.data?.scripts.map((script) => {
        const state = runs[script.id];
        return (
          <Card key={script.id}>
            <Row between>
              <View style={{ flex: 1 }}>
                <T bold>{script.label}</T>
                <T muted lines={2}>
                  {script.description ?? script.id}
                </T>
              </View>
              <Button label="Rodar" icon="play" variant="primary" busy={state?.running} onPress={() => void run(script.id)} />
            </Row>
            {state?.error ? <T color={c.danger}>{state.error}</T> : null}
            {state?.result ? (
              <>
                <T color={state.result.ok ? c.ok : c.danger}>{state.result.ok ? "ok" : `saiu com código ${state.result.exitCode}`}</T>
                {state.result.output ? (
                  <ScrollView style={s.output} nestedScrollEnabled>
                    <Text style={s.outputText} selectable>
                      {state.result.output}
                    </Text>
                  </ScrollView>
                ) : null}
              </>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
