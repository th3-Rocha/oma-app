import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui

// oma-app backend status: a phone glyph plus the number of phones talking to
// the backend right now. Dim/red when the backend is down.
//   left click   -> desktop notification with the details
//   middle click -> restart the backend service
BarWidget {
  id: root
  moduleName: "rocha.oma-app"

  // Change here if config.json uses another port.
  readonly property string statusUrl: "http://127.0.0.1:43658/api/local/status"

  property bool running: false
  property int connectedCount: 0
  property var connected: []
  property var paired: []
  property string version: ""
  property string address: ""
  property string pairingCode: ""

  readonly property color baseColor: root.bar ? root.bar.barForeground : Color.foreground
  // Fixed red: monochrome themes define "urgent" as a grey, which would not read as "down".
  readonly property color downColor: "#de6145"

  function names(list) {
    var out = []
    for (var i = 0; i < list.length; i++) out.push(list[i].name ? list[i].name : list[i].ip)
    return out.join(", ")
  }

  readonly property string summary: {
    if (!running) return "oma-app: backend parado"
    var lines = ["oma-app " + version + " em " + address]
    lines.push(connectedCount > 0 ? "Conectado: " + names(connected) : "Nenhum celular conectado")
    lines.push("Pareados: " + (paired.length > 0 ? paired.join(", ") : "nenhum"))
    if (pairingCode !== "") lines.push("Código de pareamento: " + pairingCode)
    return lines.join("\n")
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Timer {
    interval: 5000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: if (!statusProc.running) statusProc.running = true
  }

  Process {
    id: statusProc
    command: ["curl", "-s", "--max-time", "2", root.statusUrl]
    stdout: StdioCollector { id: statusOut; waitForEnd: true }
    onExited: function(code) {
      var ok = false
      if (code === 0 && statusOut.text.length > 0) {
        try {
          var data = JSON.parse(statusOut.text)
          if (data.running === true) {
            ok = true
            root.connected = data.connected || []
            root.connectedCount = root.connected.length
            root.paired = data.paired || []
            root.version = data.version || ""
            root.address = (data.ip || "?") + ":" + data.port
            root.pairingCode = data.pairingCode || ""
          }
        } catch (e) {}
      }
      root.running = ok
      if (!ok) {
        root.connected = []
        root.connectedCount = 0
        root.pairingCode = ""
      }
    }
  }

  Process {
    id: notifyProc
    command: ["notify-send", "-a", "Oma App", "Oma App", root.summary]
  }

  Process {
    id: restartProc
    command: ["systemctl", "--user", "restart", "oma-app.service"]
    onExited: statusProc.running = true
  }

  IpcHandler {
    target: "rocha.oma-app"
    function refresh() { statusProc.running = true }
    function restart() { restartProc.running = true }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    tooltipText: root.summary + "\n(clique do meio: reiniciar o serviço)"
    labelVisible: false
    hasVisualContent: true
    fixedWidth: root.vertical ? -1 : Math.ceil(contentRow.implicitWidth + Style.spaceReal(horizontalMargin) * 2)
    fixedHeight: root.vertical ? Math.ceil(contentRow.implicitHeight + Style.spaceReal(verticalPadding) * 2) : -1

    Row {
      id: contentRow
      anchors.centerIn: parent
      spacing: Style.space(4)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        // nf-md-cellphone_link / nf-md-cellphone_off
        text: root.running ? "󰄡" : "󰄟"
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.space(15)
        color: root.running ? root.baseColor : root.downColor
        opacity: root.running && root.connectedCount === 0 ? 0.55 : 1
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        visible: root.running && root.connectedCount > 0
        text: root.connectedCount
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.space(12)
        font.bold: true
        color: root.baseColor
      }
    }

    onPressed: function(b) {
      if (b === Qt.LeftButton) notifyProc.running = true
      else if (b === Qt.MiddleButton) restartProc.running = true
    }
  }
}
