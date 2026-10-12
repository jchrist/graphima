// Editor-area graphima window (central area). One singleton panel, revealed on command.
// gitHandler: async (msg) => response|null — dispatches git/request messages.
// vscode is injected (constructor / createOrShow args) so tests can pass a
// fake and any runner can load this module.
const { getWebviewHtml } = require("./getWebviewHtml");

// Share the full-color icon with the Extensions page; the status bar needs
// the same silhouette in resources/graphima.ttf because it only accepts codicons.
const ICON = "icon.png";

class GitWindowPanel {
  static currentPanel = undefined;

  constructor(panel, extensionUri, gitHandler, vscode) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.gitHandler = gitHandler;
    this.vscode = vscode;
    this.disposables = [];
    this.panel.webview.html = getWebviewHtml(
      this.panel.webview,
      this.extensionUri,
      "editor",
      this.vscode,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  static createOrShow(vscode, extensionUri, gitHandler) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (GitWindowPanel.currentPanel) {
      if (gitHandler) {
        GitWindowPanel.currentPanel.gitHandler = gitHandler;
      }
      GitWindowPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "graphima.gitWindow",
      // "Graphima", like the status bar item and the command titles: the tab
      // used to read "graphima" and the bar "Graphima".
      "Graphima",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "resources", ICON);

    GitWindowPanel.currentPanel = new GitWindowPanel(panel, extensionUri, gitHandler, vscode);
  }

  async handleMessage(msg) {
    if (!msg) {
      return;
    }
    if (msg.type === "ping") {
      void this.panel.webview.postMessage({ type: "pong", payload: msg.payload });
      return;
    }
    if (msg.type === "git/request" && this.gitHandler) {
      const response = await this.gitHandler(msg);
      if (response) {
        void this.panel.webview.postMessage(response);
      }
    }
  }

  dispose() {
    GitWindowPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

module.exports = { GitWindowPanel };
