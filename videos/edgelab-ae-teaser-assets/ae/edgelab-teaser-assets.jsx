/* EdgeLab AE Teaser Assets - actual app component captures
 * Imports rendered EdgeLab component compositions into After Effects.
 */
(function () {
  var WIDTH = 3840;
  var HEIGHT = 2160;
  var FPS = 30;
  var DURATION = 7;
  var scenes = [
  {
    "id": "session-gateway",
    "title": "Session gateway",
    "sourceComponents": [
      "SessionGateway"
    ],
    "svg": "svg/session-gateway.svg",
    "preview": "preview/session-gateway.png"
  },
  {
    "id": "replay-engine-workspace",
    "title": "Replay engine workspace",
    "sourceComponents": [
      "TradingChart",
      "ReplayController"
    ],
    "svg": "svg/replay-engine-workspace.svg",
    "preview": "preview/replay-engine-workspace.png"
  },
  {
    "id": "trade-journal-notes",
    "title": "Trade journal / notes",
    "sourceComponents": [
      "JournalWorkspacePage"
    ],
    "svg": "svg/trade-journal-notes.svg",
    "preview": "preview/trade-journal-notes.png"
  },
  {
    "id": "playbooks",
    "title": "Playbooks",
    "sourceComponents": [
      "PlaybookBoard"
    ],
    "svg": "svg/playbooks.svg",
    "preview": "preview/playbooks.png"
  },
  {
    "id": "analytics-reports-dashboard",
    "title": "Analytics / reports dashboard",
    "sourceComponents": [
      "ResultsPanel"
    ],
    "svg": "svg/analytics-reports-dashboard.svg",
    "preview": "preview/analytics-reports-dashboard.png"
  },
  {
    "id": "position-order-tools",
    "title": "Position / order tools",
    "sourceComponents": [
      "OrderTicket",
      "PositionPanel",
      "TradeLog"
    ],
    "svg": "svg/position-order-tools.svg",
    "preview": "preview/position-order-tools.png"
  },
  {
    "id": "position-sizing-calculator",
    "title": "Position sizing calculator",
    "sourceComponents": [
      "PositionSizeCalculatorPage"
    ],
    "svg": "svg/position-sizing-calculator.svg",
    "preview": "preview/position-sizing-calculator.png"
  },
  {
    "id": "economic-calendar",
    "title": "Economic calendar",
    "sourceComponents": [
      "EconomicCalendarPage"
    ],
    "svg": "svg/economic-calendar.svg",
    "preview": "preview/economic-calendar.png"
  }
];
  var scriptFile = new File($.fileName);
  var rootFolderPath = scriptFile.parent.parent.fsName;

  app.beginUndoGroup("Import EdgeLab actual component captures");
  var project = app.project || app.newProject();
  var rootFolder = project.items.addFolder("EdgeLab Actual Component Captures");

  for (var i = 0; i < scenes.length; i += 1) {
    var scene = scenes[i];
    var comp = project.items.addComp("EdgeLab - " + scene.title, WIDTH, HEIGHT, 1, DURATION, FPS);
    comp.parentFolder = rootFolder;

    var pngFile = new File(rootFolderPath + "/" + scene.preview);
    if (pngFile.exists) {
      var pngItem = project.importFile(new ImportOptions(pngFile));
      pngItem.parentFolder = rootFolder;
      var pngLayer = comp.layers.add(pngItem);
      pngLayer.name = scene.id + " actual app preview";
      pngLayer.outPoint = DURATION;
    }

    var svgFile = new File(rootFolderPath + "/" + scene.svg);
    if (svgFile.exists) {
      var svgItem = project.importFile(new ImportOptions(svgFile));
      svgItem.parentFolder = rootFolder;
      var svgLayer = comp.layers.add(svgItem);
      svgLayer.name = scene.id + " actual app SVG composition";
      svgLayer.outPoint = DURATION;
      svgLayer.enabled = false;
    }

    var label = comp.layers.addText("Source components: " + scene.sourceComponents.join(", "));
    label.name = scene.id + " source component label";
    label.enabled = false;
    comp.markerProperty.setValueAtTime(0.5, new MarkerValue("Actual EdgeLab components: " + scene.sourceComponents.join(", ")));
  }

  app.endUndoGroup();
}());
