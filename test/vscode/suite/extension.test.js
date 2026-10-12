// Runs inside the real VS Code Extension Host. Covers what fakes cannot:
// contribution loading, activation, command execution, view registration.
const assert = require("node:assert/strict");
const vscode = require("vscode");

describe("graphima in real VS Code", () => {
  it("extension is present and activates", async () => {
    const ext = vscode.extensions.getExtension("jchrist.graphima");
    assert.ok(ext, "jchrist.graphima installed in the test host");
    await ext.activate();
    assert.equal(ext.isActive, true);
  });

  it("commands are contributed", async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const id of ["graphima.openGitWindow", "graphima.probeGitService"]) {
      assert.ok(cmds.includes(id), `${id} registered`);
    }
    assert.ok(!cmds.includes("graphima.openGitWindowInPanel"), "no bottom-panel command");
  });

  it("open window command executes", async () => {
    await vscode.commands.executeCommand("graphima.openGitWindow");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  it("probe executes against the fixture workspace", async () => {
    assert.ok((vscode.workspace.workspaceFolders || []).length > 0, "fixture workspace open");
    await vscode.commands.executeCommand("graphima.probeGitService");
  });
});
