import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";

import { Bar, Button, Card, Row, Screen, T, attempt, confirm, toast } from "@/components/ui";
import { ApiError, useConnection } from "@/lib/connection";
import { discover, isIpv4, ping, type Found } from "@/lib/discovery";
import { DEFAULT_PORT } from "@/lib/storage";
import { fonts, themed, useColors } from "@/lib/theme";
import { isMac } from "@/lib/wol";

const DEVICE_NAME = (() => {
  const constants = Platform.constants as { Model?: string; Brand?: string } | undefined;
  return [constants?.Brand, constants?.Model].filter(Boolean).join(" ") || `celular ${Platform.OS}`;
})();

const useStyles = themed((c) => ({
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: c.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    backgroundColor: c.bg,
  },
  code: { fontSize: 24, letterSpacing: 8, textAlign: "center", fontFamily: fonts.bold },
}));

export default function Connect() {
  const s = useStyles();
  const c = useColors();
  const { server, online, paired, api, setServer, adopt, refreshTheme, checkNow } = useConnection();

  // --- discovery --------------------------------------------------------------
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const scan = useCallback(async () => {
    setScanning(true);
    setProgress(null);
    setFound(null);
    cancelled.current = false;
    try {
      const results = await discover(
        server?.port ?? DEFAULT_PORT,
        (done, total) => setProgress(done / total),
        server?.host,
        () => cancelled.current,
      );
      if (cancelled.current) return;
      setFound(results);
      if (results.length === 1) {
        await adopt(results[0]);
        toast(`Encontrado: ${results[0].hostname}`);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha na busca");
      setFound([]);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [server, adopt]);

  // --- manual ----------------------------------------------------------------
  const [manual, setManual] = useState("");
  const [checking, setChecking] = useState(false);

  const connectManual = useCallback(async () => {
    const [host, portText] = manual.trim().split(":");
    const port = portText ? Number(portText) : DEFAULT_PORT;
    if (!isIpv4(host) || !Number.isInteger(port)) {
      toast("Use o formato 192.168.0.10 ou 192.168.0.10:43658");
      return;
    }
    setChecking(true);
    const info = await ping(host, port, 2500);
    setChecking(false);
    if (!info) {
      toast("Nenhum backend oma-app respondeu nesse endereço");
      return;
    }
    await adopt(info);
    setManual("");
    toast(`Conectado a ${info.hostname}`);
  }, [manual, adopt]);

  // --- pairing ---------------------------------------------------------------
  const [codeRequested, setCodeRequested] = useState(false);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);

  const requestCode = useCallback(async () => {
    const ok = await attempt(() => api("/api/pair/start", { body: { deviceName: DEVICE_NAME } }));
    if (ok !== undefined) {
      setCodeRequested(true);
      setCode("");
      toast("Código exibido numa notificação no PC");
    }
  }, [api]);

  const finishPairing = useCallback(async () => {
    if (!server) return;
    setPairing(true);
    try {
      const result = await api<{ token: string }>("/api/pair/finish", { body: { code, deviceName: DEVICE_NAME } });
      await setServer({ ...server, token: result.token });
      setCodeRequested(false);
      setCode("");
      refreshTheme();
      toast("Pareado!");
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Falha ao parear");
    } finally {
      setPairing(false);
    }
  }, [api, code, server, setServer, refreshTheme]);

  // --- MAC ---------------------------------------------------------------------
  // The field follows the saved MAC until the user edits it.
  const [mac, setMac] = useState(server?.mac ?? "");
  const [macSource, setMacSource] = useState(server?.mac);
  if (macSource !== server?.mac) {
    setMacSource(server?.mac);
    setMac(server?.mac ?? "");
  }

  return (
    <Screen title="Conexão" subtitle={DEVICE_NAME}>
      {server ? (
        <Card title="PC atual">
          <Row between>
            <View style={{ flex: 1 }}>
              <T bold>{server.hostname ?? server.host}</T>
              <T muted>
                {server.host}:{server.port}
              </T>
            </View>
            <T color={online ? (paired ? c.ok : c.warn) : c.danger} bold>
              {online === null ? "…" : online ? (paired ? "online" : "não pareado") : "offline"}
            </T>
          </Row>
          <T muted>MAC para Wake-on-LAN</T>
          <Row>
            <TextInput
              style={s.input}
              value={mac}
              onChangeText={setMac}
              placeholder="aa:bb:cc:dd:ee:ff"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              label="Salvar"
              disabled={mac === (server.mac ?? "")}
              onPress={() => {
                if (!isMac(mac)) {
                  toast("MAC inválido");
                  return;
                }
                void setServer({ ...server, mac: mac.trim().toLowerCase() }).then(() => toast("MAC salvo"));
              }}
            />
          </Row>
          <Row>
            <Button label="Testar" icon="refresh-cw" style={{ flex: 1 }} onPress={() => void checkNow().then((ok) => toast(ok ? "PC respondeu" : "Sem resposta"))} />
            <Button
              label="Esquecer"
              icon="trash-2"
              variant="danger"
              style={{ flex: 1 }}
              onPress={() => confirm("Esquecer PC", "Remove o endereço, o MAC e o pareamento deste celular.", () => void setServer(null), "Esquecer")}
            />
          </Row>
        </Card>
      ) : null}

      {server && online && !paired ? (
        <Card title="Parear">
          <T muted>
            O PC mostra um código de 6 dígitos numa notificação. Digite aqui para autorizar este celular.
          </T>
          {codeRequested ? (
            <>
              <TextInput
                style={[s.input, s.code]}
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                placeholder="000000"
                placeholderTextColor={c.muted}
                autoFocus
                maxLength={6}
              />
              <Row>
                <Button label="Novo código" style={{ flex: 1 }} onPress={requestCode} />
                <Button label="Confirmar" variant="primary" style={{ flex: 1 }} busy={pairing} disabled={code.length !== 6} onPress={finishPairing} />
              </Row>
            </>
          ) : (
            <Button label="Pedir código" icon="key" variant="primary" onPress={requestCode} />
          )}
        </Card>
      ) : null}

      <Card title="Procurar na rede">
        <T muted>Procura o backend no Wi-Fi atual: primeiro por broadcast UDP, depois varrendo a sub-rede.</T>
        <Button label={scanning ? "Procurando…" : "Procurar PC"} icon="search" variant={server ? "default" : "primary"} busy={scanning} onPress={scan} />
        {scanning && progress !== null ? <Bar value={progress} color={c.accent} /> : null}
        {found && found.length === 0 ? (
          <T color={c.warn}>Nada encontrado. Confira se o PC está ligado, o serviço rodando e a porta {DEFAULT_PORT} liberada no firewall.</T>
        ) : null}
        {found && found.length > 1
          ? found.map((item) => (
              <Button key={item.host} label={`${item.hostname} · ${item.host}`} icon="monitor" onPress={() => void adopt(item).then(() => toast(`Usando ${item.hostname}`))} />
            ))
          : null}
      </Card>

      <Card title="Endereço manual">
        <Row>
          <TextInput
            style={s.input}
            value={manual}
            onChangeText={setManual}
            placeholder={`192.168.0.10:${DEFAULT_PORT}`}
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onSubmitEditing={connectManual}
          />
          <Button label="Conectar" busy={checking} disabled={manual.trim().length === 0} onPress={connectManual} />
        </Row>
      </Card>
    </Screen>
  );
}
